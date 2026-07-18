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
code-doctor scan
code-doctor graph
code-doctor map build --focus "首页会员弹窗"
code-doctor map open
code-doctor map check "会员到期用户必须看到续费弹窗"
code-doctor map open --report
code-doctor run --one --open-mr
```

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
├── business-map.html          # 人类可读的分层地图
├── map-run.json               # Agent 和本次建图审计记录
├── map-agent-stdout.jsonl
└── map-agent-stderr.log
```

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

## GitLab 定时执行

```bash
code-doctor ci install
```

提交生成的 `.gitlab/code-doctor.yml` 后，在 GitLab 的 **CI/CD → Schedules** 中创建每日 Pipeline。CI 需要：

- 能访问 GitHub 并安装 Code Doctor；
- 可用的 `CODEX_API_KEY`、`ANTHROPIC_API_KEY` 或自定义 Agent 凭证；
- 允许推送 `code-doctor/*` 分支并创建 MR 的 GitLab Token；
- 目标项目依赖和测试环境。

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
