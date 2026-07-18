# Code Doctor

Code Doctor 是一个 AI 业务代码审计系统，解决 AI 生成代码后人类难以理解真实业务行为、历史逻辑缺陷持续堆积，以及客户端到服务端链路难以追溯的问题。

它以 AI 作为业务理解和审计引擎，以源码、调用图、测试和 Git 作为证据工具：AI 将复杂实现压缩成可视化业务地图，人类可以用自然语言需求检查实际行为，再把结论追溯到具体源码。传统扫描和“每天修一个问题”仍然保留，但不再是产品核心。

本项目采用 MIT License，可供团队和社区自由使用，并以 `@thunder-doctor/code-doctor` 发布到 npmjs。

## 当前能力

### AI 业务审计

- Codex、Claude Code 或任意自定义 Agent 从项目代码生成精简业务地图。
- 地图表达角色、场景、状态、判断、动作、结果、系统和外部副作用。
- 每个业务节点和路径带有源码证据、知识状态和置信度。
- 区分代码事实、AI 推断、人工确认、未知和证据冲突，不把模型猜测伪装成事实。
- 使用自然语言需求检查业务地图，输出满足、违反或证据不足的结论。
- 生成可交互的业务地图和审计报告，支持从业务结果下钻到源码。
- Agent 只负责理解和调查；Code Doctor 校验文件、行号、节点引用和证据引用。
- 建图和审计期间禁止 Agent 修改项目源码或 Git 状态。

### 技术扫描与修复

- 自动发现 React Doctor、ESLint、TypeScript、staticcheck、golangci-lint 或 go vet。
- 统一解析 React Doctor、ESLint、TypeScript、Go、SARIF 和通用 JSON 诊断。
- 每次只选择一个诊断交给 AI，扫描器的 `fixable` 标记仅作审计信息，不限制 AI 候选。
- 自动选择本机 Codex 或 Claude Code，也支持任何自定义 Agent 命令。
- 扫描器缺失、超时或异常退出时明确失败，不会伪装成“零问题”。
- 修复前后都执行项目验证：原本通过的门禁不得退化，历史基线失败不会阻止独立修复。
- 分析 JavaScript、TypeScript、Vue SFC 和 Go 的文件依赖、函数调用、HTTP 请求和服务端路由。
- 输出 `graph.json` 和单文件 `graph.html`，不需要部署后台。
- 保存扫描、Agent 输出、测试、调用图和运行结论作为 CI Artifact。

## 快速开始

```bash
npm install --global @thunder-doctor/code-doctor

cd your-project
code-doctor init
code-doctor map discover
code-doctor takeover start --owner "新Owner"
code-doctor scan
code-doctor graph
code-doctor map build --focus "首页会员弹窗" --id home-popup
code-doctor map confirm home-popup --by "业务Owner"
code-doctor project build --all
code-doctor project build
code-doctor project open
code-doctor map open
code-doctor map check "会员到期用户必须看到续费弹窗"
code-doctor map open --report
code-doctor run --one --open-mr
```

## 项目长期知识

项目只需要执行一次 `code-doctor init`。初始化会创建可提交到 Git 的长期知识目录：

```text
.code-doctor/
├── knowledge/                       # 长期沉淀，建议提交 Git
│   ├── project.yaml                 # 项目定位（初始为空，避免 AI 猜业务事实）
│   ├── project.candidate.yaml       # map discover 生成的待审项目定位
│   ├── atlas.yaml                   # 业务场景目录与学习依赖
│   ├── scenarios/
│   │   ├── home-popup.candidate.json # AI 候选，尚未人工确认
│   │   └── vip-renewal.json          # 已经过人工 review
│   ├── rules.yaml                   # 人工确认的期望业务规则
│   ├── questions.yaml               # 待历史 Owner / 产品确认的问题
│   └── takeover.yaml                # 新 Owner 的渐进式接管进度
├── cache/                           # 可重建，不提交
├── snapshots/                       # 临时基线，不提交
└── output/                          # HTML、报告、Agent 日志，不提交
```

Code Doctor 明确区分三种真相：

- 实现真相：代码现在实际做什么；
- 业务真相：人类确认它应该做什么；
- 运行真相：测试、日志和线上实际发生什么。

AI 产物首先保存为 `*.candidate.json`。只有人工 review 后才能提升为项目知识：

```bash
code-doctor map confirm home-popup --by "业务Owner"
```

确认整个场景不等于把所有 AI 推断改成事实；节点仍然保留 fact、inference、unknown、conflicted 等证据状态。

人工确认的“应该如何运行”通过规则单独沉淀，并会自动进入 MR 和每日审计上下文：

```bash
code-doctor rule add \
  --id vip-expire-daily-limit \
  --scenario home-popup \
  --statement "会员过期弹窗每天最多自动展示一次" \
  --by "业务Owner"

code-doctor rule list --scenario home-popup
```

没有人工确认规则时，Agent 只能报告实现风险，不能把自己的推断说成产品需求错误。

## 渐进式项目接管

新 Owner 不需要先知道应该检查什么。先让 Agent 从整个项目发现 6～20 个候选业务场景：

```bash
code-doctor map discover
code-doctor takeover start --owner "新Owner"
code-doctor takeover next
```

`map discover` 只建立候选目录和学习依赖，不会把项目文件夹直接当成业务。`takeover next` 优先推荐关键、依赖已满足的场景；场景尚未建图时会给出对应的 `map build` 命令。

完成理解后由 Owner 自己确认：

```bash
code-doctor takeover confirm home-popup --by "新Owner"
code-doctor takeover progress
```

“Owner 已理解”与“业务地图已人工确认”分别记录，避免将学习进度误当成业务真相。

## 项目业务审计总览

`map discover` 和逐场景 `map build` 的长期知识可以聚合成一个项目级入口：

```bash
# 第一次全量建立项目地图：没有场景目录时会先发现，再严格串行逐场景建图
code-doctor project build --all

# 只重新聚合已有知识，不调用 Agent
code-doctor project build
code-doctor project open

# 在已有项目地图上检测结构断链，并让 Agent 审计跨场景业务逻辑
code-doctor project audit
```

全量建图可能需要较长时间，因此每个场景开始、成功或失败后都会立即更新
`.code-doctor/output/project-build-run.json`。运行被中断后再次执行 `project build --all`，
会跳过已有地图和已完成项，只重试失败或未处理项；单场景失败不会删除其他场景结果，最终报告也会明确显示失败和待处理边界。常用控制：

```bash
# 本次最多处理 3 个场景，适合定时任务分批运行
code-doctor project build --all --limit 3

# 忽略完成状态，强制重新建立所有场景地图
code-doctor project build --all --refresh

# 临时指定 Agent，仍兼容项目 code-doctor.yaml 的 custom 配置
code-doctor project build --all --agent claude
```

场景按 `dependsOn` 的依赖拓扑顺序处理，同一可执行层内按 critical、high、normal
和稳定 id 排序。Agent 始终逐一运行，不会并发争用同一个代码工作区或候选输出文件。

生成 `.code-doctor/output/project-report.json` 和自包含的
`.code-doctor/output/project-report.html`。HTML 不需要部署服务或访问 CDN，交给其他人即可离线打开。

项目总览展示：

- 全项目候选业务目录、优先级和场景依赖；
- 待建图、候选地图、已确认、有待审更新四种知识状态；
- 场景地图证据代码变化后的待审状态；
- 业务建图覆盖率、人工确认覆盖率和证据文件可用率；
- 未建图场景、缺失证据、AI 不确定项和证据冲突等审计边界；
- 全量运行中的待处理、失败原因和已完成覆盖，失败不会被误报成“没有业务”；
- 从项目全景下钻到单场景的章节、节点、路径条件和源码证据。

这份报告明确表达“当前发现并获得证据的业务”，不会把未建图范围隐藏起来，也不会把
“已扫描代码”错误表述成“已证明不存在业务漏洞”。旧版直接保存 BusinessMap 的
`scenarios/*.json` 知识目录仍可读取。

### 项目级业务风险审计

`code-doctor project audit` 先运行不依赖 AI 的确定性图结构检查，再让配置的 Agent
基于所有已建图场景和源码证据复核业务语义。两层结果都会写入
`.code-doctor/output/project-audit.json`，并聚合进同一个
`.code-doctor/output/project-report.html`；不会生成另一个需要来回切换的报告入口。

确定性层检查无入口、无结果、非结果节点死端、判断节点分支不足、空白或重复条件、
孤立组件、证据缺失和证据冲突。这些信号只表述为“结构风险/需复核”，不会仅凭图结构
宣称代码一定存在业务漏洞。AI 层专门检查不可达业务结果或弹窗、条件覆盖和互斥错误、
状态转换缺口、跨场景规则矛盾与副作用遗漏；命名、格式、lint 等机械问题不进入该报告。

每条 AI 结论必须回指现有的场景 id、节点 id 和证据 id。引用不存在时整次 AI 候选会被
拒绝；没有 source、test、runtime 或 human 强证据的结论会自动降为 `uncertain`。
Agent 退出失败、输出无效或修改业务工作区时，确定性结果仍会持久化，并在 HTML 中明确
标注“AI 审计未完成”，不会把失败伪装成零风险。

```bash
# 完整结构 + AI 业务逻辑审计（默认使用 code-doctor.yaml 中的 Agent）
code-doctor project audit

# 临时指定 Agent
code-doctor project audit --agent claude

# CI 或离线环境只做确定性结构审计
code-doctor project audit --no-agent
```

审计只覆盖已建图场景。未建图场景、过期地图、缺失证据文件和未完成的 Agent 审计都会
进入“未知与审计边界”，因此即使风险列表为空，也不等于项目业务安全。

## AI 业务地图

先明确一个业务场景、页面、入口或问题，让 Agent 聚焦理解，而不是一次吞下整个历史系统：

```bash
code-doctor map build --focus "首页开屏弹窗的选择、优先级与展示条件"
```

生成：

```text
.code-doctor/output/
├── graph.json                 # 底层技术证据图
├── business-map.json          # 结构化业务地图
├── business-map.html          # 可离线打开的交互式业务画布
├── map-run.json               # Agent 和本次建图审计记录
├── map-agent-stdout.jsonl
└── map-agent-stderr.log
```

`business-map.html` 是一个自包含的 React Flow 无限画布，不依赖业务项目启动服务或访问 CDN。它提供：

- 默认先展示 4～8 个 AI 归纳的业务章节，点击章节后再进入局部场景地图；
- 业务全景、场景地图、链路与代码证据三级渐进式下钻；
- ELK 从左到右自动布局，业务节点和路径条件都参与尺寸测量、层级排列与空间避让；
- 无限点阵画布支持缩放、拖拽、MiniMap 和全景恢复，点阵仅作导航参照、不决定节点位置；
- 角色、场景、动作、判断、状态、系统、结果、副作用八类节点样式；
- 固定图例，分开表达节点类型与代码事实、人工确认、AI 推断、未知和证据冲突；
- 点击节点或路径后聚焦完整上下游，并可切换“问题从哪来”和“会影响哪里”；
- 按业务词、源码文件或证据内容搜索，选择结果后定位到对应链路；
- 右侧查看路径条件、置信度、源码文件与行号证据。

节点位置只属于当前浏览视图，不会写回业务知识；地图仍由结构化 JSON、源码证据和人工确认决定。

然后使用人类需求检查实际实现：

```bash
code-doctor map check "新用户、普通用户和会员到期用户应该分别展示对应弹窗"
```

Code Doctor 会要求 Agent 先解释需求，再主动寻找支持证据和反证，最终输出：

```text
.code-doctor/output/audit-report.json
.code-doctor/output/audit-report.html
```

`map ask` 是同一套证据化审计能力的对话式别名：

```bash
code-doctor map ask "续费弹窗是否存在永远无法到达的路径？"
```

业务地图不是静态分析工具自动画出的函数图。技术调用图只提供线索，最终业务节点、条件和结果由 Agent 结合源码上下文理解；Code Doctor 再对它引用的证据做确定性校验。证据不足时，正确结果是 `uncertain`，而不是猜测。

开发阶段也可以直接从本仓库运行：

```bash
npm install
npm run build
node dist/cli.js scan -C /path/to/project
```

## 配置

`code-doctor init` 会生成 `code-doctor.yaml`：

```yaml
version: 1
scanners:
  - name: auto
    command: auto
    parser: auto
agent:
  provider: auto
  timeoutMs: 900000
verify: []
graph:
  enabled: true
  include:
    - "**/*.ts"
    - "**/*.tsx"
    - "**/*.js"
    - "**/*.jsx"
    - "**/*.vue"
    - "**/*.go"
businessMap:
  enabled: true
  maxNodes: 80
  maxEvidence: 200
audit:
  maxScenariosPerRun: 3
gitlab:
  enabled: true
  remote: origin
  targetBranch: main
  labels:
    - code-doctor
limits:
  maxChangedFiles: 6
  maxChangedLines: 250
ignore: []
```

`provider: auto` 按顺序检测 `codex`、`claude`。自定义 Agent 示例：

```yaml
agent:
  provider: custom
  command: my-agent run --prompt-file {promptFile} --workspace {root}
```

自定义扫描器只需要输出支持的格式：

```yaml
scanners:
  - name: company-sast
    command: company-sast scan --format sarif
    parser: sarif
```

通用 JSON 格式：

```json
{
  "diagnostics": [
    {
      "rule": "unsafe-empty-catch",
      "severity": "warning",
      "message": "异常被静默吞掉",
      "file": "src/service.ts",
      "line": 42,
      "fixable": true
    }
  ]
}
```

## 持续审计与 GitLab CI

人工触发：

```bash
# 只审计某次 Git 变更实际影响的已沉淀场景
code-doctor audit --changed origin/main...HEAD

# 每天深入检查一个历史业务场景
code-doctor audit --deep --one
```

变更文件通过场景地图中的源码证据关联到业务场景。没有被任何场景覆盖的变更不会伪装成“无影响”，而会明确记为知识覆盖缺口。

GitLab 可以选择 MR、每日或两种模式同时安装：

```bash
code-doctor ci install --mode both
# 也可以使用 --mode mr、push、daily 或 all
```

生成的 CI 默认执行：

- Merge Request：`audit --changed "$CI_MERGE_REQUEST_DIFF_BASE_SHA...$CI_COMMIT_SHA"`；
- 每次 Push：`audit --changed "$CI_COMMIT_BEFORE_SHA...$CI_COMMIT_SHA"`；
- Schedule：`audit --deep --one`；
- Web Pipeline：可手动触发每日深度审计。

`both` 表示 MR + 每日，`all` 表示 MR + 每次 Push + 每日。提交生成的 `.gitlab/code-doctor.yml` 后，如启用 daily 模式，在 GitLab 的 **CI/CD → Schedules** 中创建每日 Pipeline。CI 需要：

- 能访问 GitHub 并安装 Code Doctor；
- 可用的 `CODEX_API_KEY`、`ANTHROPIC_API_KEY` 或自定义 Agent 凭证；
- 目标项目依赖和测试环境。

持续审计只读代码并生成 Artifact，不需要推送权限。只有继续使用旧的 `run --one --open-mr` 自动修复流程时，才需要允许推送 `code-doctor/*` 分支和创建 MR 的 GitLab Token。

默认模板从 npmjs 公开包安装，不需要读取私有 npm Registry。

系统不会自动合并 MR。

## 调用图

```bash
code-doctor graph
open .code-doctor/output/graph.html
```

当前确定性提取：

- JS/TS/JSX/TSX 相对路径 import 与 Vue 常用的 `@/` 路径；
- Vue SFC 的 `<script>` / `<script setup>`；
- JS/TS 函数和方法调用；
- `fetch`、Axios 风格 HTTP 调用；
- Express/Fastify 风格路由；
- NestJS `Controller` 与 HTTP 方法装饰器；
- Go 函数调用；
- Gin/Echo/Chi 风格路由与 `net/http`；
- Go HTTP 客户端调用。

实线表示从源码直接确认的关系，虚线表示基于唯一函数名匹配得到的推断关系。动态图 URL、反射、依赖注入和运行时路由无法仅靠静态代码完全恢复，后续可通过 OpenAPI 和 OpenTelemetry 适配器补充。

## 审计产物

每次运行在 `.code-doctor/output/` 生成：

```text
diagnostics.json
graph.json
graph.html
business-map.json
business-map.html
project-report.json
project-report.html
audit-index.json
audit-report.<scenario-id>.json
audit-report.<scenario-id>.html
run.json
verification-baseline.json
verification.json
agent-stdout.jsonl
agent-stderr.log
```

这些文件默认不提交到业务仓库，由 GitLab CI 保存为 Artifact；Git 提交、Pipeline 和 MR 构成长期审计链路。

## 安全边界

- 只在干净工作区中启动。
- 每次只修复一个诊断。
- 默认最多修改 6 个文件、250 行。
- Agent 不负责提交、推送和创建 MR。
- 原诊断必须在重新扫描后消失。
- 修改前通过的项目验证命令，修改后必须继续通过；已有失败会记录为基线。
- MR 必须由人类审核，不自动合并。
