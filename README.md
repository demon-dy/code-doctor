# Code Doctor

Code Doctor 解决历史代码问题持续堆积、AI 一次修改范围过大，以及客户端到服务端调用链难以理解的问题。

它是一个轻量 CLI：复用项目已有扫描器，每次只选择一个问题交给 Codex、Claude Code 或自定义 Agent 修复；验证通过后创建 GitLab MR，并生成可搜索的 TS/Go 静态调用图供人类审核和排障。

本项目和 npm 包均为公司内部资产，只允许发布到 `g.ktvsky.com` 的私有 GitLab Package Registry，禁止发布到 npmjs 或其他外部仓库。发布前置脚本会强制检查 Registry 地址。

## 当前能力

- 自动发现 React Doctor、ESLint、TypeScript、staticcheck、golangci-lint 或 go vet。
- 统一解析 React Doctor、ESLint、TypeScript、Go、SARIF 和通用 JSON 诊断。
- 每次只选择一个可修复诊断，并限制修改文件数和代码行数。
- 自动选择本机 Codex 或 Claude Code，也支持任何自定义 Agent 命令。
- 修复后重新扫描并执行项目测试，通过后提交分支并可创建 GitLab MR。
- 分析 TypeScript/TSX 和 Go 的文件依赖、函数调用、HTTP 请求和服务端路由。
- 输出 `graph.json` 和单文件 `graph.html`，不需要部署后台。
- 保存扫描、Agent 输出、测试、调用图和运行结论作为 CI Artifact。

## 快速开始

```bash
npm config set @thunder:registry "https://g.ktvsky.com/api/v4/projects/2088/packages/npm/"
npm config set -- "//g.ktvsky.com/api/v4/projects/2088/packages/npm/:_authToken" "$GITLAB_TOKEN"
CODE_DOCTOR_TARBALL="$(npm pack --silent @thunder/code-doctor)"
npm install --global "./$CODE_DOCTOR_TARBALL"
rm -f "$CODE_DOCTOR_TARBALL"

cd your-project
code-doctor init
code-doctor scan
code-doctor graph
code-doctor run --one --open-mr
```

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
    - "**/*.go"
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

- 能安装或运行 `@thunder/code-doctor`；
- 可用的 `CODEX_API_KEY`、`ANTHROPIC_API_KEY` 或自定义 Agent 凭证；
- 允许推送 `code-doctor/*` 分支并创建 MR 的 GitLab Token；
- 目标项目依赖和测试环境。

默认模板通过 `CI_JOB_TOKEN` 从 GitLab npm Package Registry 安装。如果目标项目没有跨项目读取权限，需要在 Code Doctor 项目的 Job Token allowlist 中加入目标项目，或改用具备 `read_package_registry` 权限的 Deploy Token。

当前公司 GitLab 为 13.12，该版本的 npm Registry 元数据响应不包含 `bin` 字段；直接执行 `npm install --global @thunder/code-doctor` 不会创建命令链接。因此安装流程先用 `npm pack` 下载发布包，再从 tarball 安装。升级 GitLab 后可恢复为标准的一行安装命令。

系统不会自动合并 MR。

## 调用图

```bash
code-doctor graph
open .code-doctor/output/graph.html
```

当前确定性提取：

- TS/TSX 相对路径 import；
- TS 函数和方法调用；
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
- 项目验证命令必须通过。
- MR 必须由人类审核，不自动合并。
