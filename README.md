# dsh-repo-atlas / RepoAtlas 代码星图

> A DeepSeek Harness plugin that helps an AI coding agent understand a repository from evidence, then review proposed changes through a bounded lifecycle.<br>
> 一个帮助 AI coding agent 基于证据理解代码库，并在有界生命周期中审阅变更提案的 DeepSeek Harness 插件。

[![CI](https://github.com/zhenkun26/dsh-repo-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/zhenkun26/dsh-repo-atlas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](package.json)

## In one minute / 一分钟了解

**What is it? / 它是什么？**

`dsh-repo-atlas` is a DeepSeek Harness plugin for repository onboarding, evidence-backed codebase analysis, and reviewable change proposals. It helps an agent answer: “What is in this repository?”, “Which conclusions are directly supported by files?”, and “What is the current state of a proposed change?”<br>
`dsh-repo-atlas` 是一个 DeepSeek Harness 插件，用于项目接手、基于证据的代码库分析和可审阅的变更提案。它帮助 agent 回答：“这个仓库有什么？”、“哪些结论有文件证据支持？”以及“一个变更提案目前处于什么状态？”

**What does it do? / 它做什么？**

- Scans a confirmed workspace with path, content, sensitive-file, and budget limits.<br>在路径、内容、敏感文件和预算限制下扫描已确认的 workspace。
- Produces structured evidence, Markdown reports, architecture observations, and a recommended reading order.<br>生成结构化证据、Markdown 报告、架构观察和推荐阅读顺序。
- Searches retained evidence and traces possible file-level change impact through static imports, with explicit snapshot and coverage limits.<br>检索保留的证据，并沿静态导入关系追踪文件级潜在影响，明确标注快照与覆盖范围限制。
- Tracks session-only proposals, patch review/verification, isolated commits, landing preflight, recovery guidance, and release preflight.<br>追踪仅限当前 session 的提案、补丁审阅/验证、隔离 commit、landing preflight、恢复建议和 release preflight。

**What does it not do automatically? / 它不会自动做什么？**

The default path is read-only. It does not silently generate or apply patches, commit, merge, land, push, publish, install dependencies, access the network, or upload code. Controlled actions are opt-in and require the relevant approval and sandbox checks.<br>
默认路径是只读的。它不会静默生成或应用补丁、commit、merge、landing、push、publish、安装依赖、访问网络或上传代码。受控动作必须显式启用，并通过对应审批和 sandbox 检查。

## What it provides / 提供什么

### Understand an unfamiliar repository / 理解陌生代码库

- **Onboarding analysis** — technology stack, entry points, important directories, tests, configuration, and a recommended reading order.<br>**项目接手分析**：技术栈、入口、重要目录、测试、配置和推荐阅读顺序。
- **Evidence-first conclusions** — separates file-backed observations from text-based inference and keeps partial or unknown states explicit.<br>**证据优先的结论**：区分文件直接支持的观察和文本推断，并明确保留 partial/unknown 状态。
- **Bounded TypeScript/JavaScript syntax confirmation** — confirms selected imports, declarations, and relationships without executing repository code.<br>**有界 TypeScript/JavaScript 语法确认**：确认选定的 import、声明和关系，但不执行仓库代码。
- **Session-only incremental reuse** — reuses compatible evidence only inside the current Harness session.<br>**仅限 session 的增量复用**：只在当前 Harness session 内复用兼容证据。

### Review a proposed change / 审阅变更提案

- Define explicit targets and intent for a session-only proposal.<br>为仅限当前 session 的提案定义明确目标和意图。
- Review, export, and verify a bounded patch when the lifecycle reaches those states.<br>在生命周期到达对应状态后审阅、导出和验证有界补丁。
- Inspect live worktree state, commit readiness, landing relation, recovery guidance, and release readiness as separate observations.<br>分别观察 live worktree 状态、commit 就绪情况、landing 关系、恢复建议和 release 就绪情况。
- Keep “ready to review” separate from “already applied”.<br>明确区分“准备审阅”和“已经应用”。

The existing Harness tool names remain stable: `repo_atlas_analyze`, `repo_atlas_change_proposal`, and the opt-in `repo_atlas_controlled_action`.<br>
现有 Harness 工具名保持稳定：`repo_atlas_analyze`、`repo_atlas_change_proposal`，以及 opt-in 的 `repo_atlas_controlled_action`。

## Evidence queries / 证据查询

After `repo_atlas_analyze` completes in a Harness session, use these native tools:<br>
在 Harness 会话中完成 `repo_atlas_analyze` 后，可使用以下原生工具：

| Tool / 工具 | Example input / 输入示例 | Result / 结果 |
|---|---|---|
| `repo_atlas_search` | `{"query":"server","limit":10}` | Ranked evidence ids, paths, locators and excerpts / 排序后的证据 ID、路径、定位和摘录 |
| `repo_atlas_impact` | `{"targets":["src/server.ts"],"maxDepth":3,"limit":50}` | Possible dependents and evidence chains / 潜在依赖方与证据链 |

Queries read the latest retained snapshot in the exact calling session. They do not
refresh files. Rerun analysis after edits. Empty results do not prove no impact;
aliases, dynamic imports, runtime calls, and unobserved files remain outside this
file-level analysis.<br>
查询只读取当前调用会话保留的最新分析快照，不刷新文件；修改后需重新分析。空结果不代表没有影响；别名、动态导入、运行时调用和未观察文件不在本轮文件级分析范围内。

The current Harness source review and implementation stages are documented in the
[October plan](docs/replanning-2026-10.md). The reviewed `0.2.1-alpha.1` source is
not yet an accepted runtime compatibility target.<br>
当前 Harness 源码审查和实施阶段见[十月重规划](docs/replanning-2026-10.md)。已审查的 `0.2.1-alpha.1` 源码尚未成为通过运行验收的兼容目标。

## Quick start / 快速开始

### Requirements / 环境要求

- Node.js 22 or newer for local development and checks.<br>本地开发和检查需要 Node.js 22 或更高版本。
- A compatible DeepSeek Harness checkout for loading the plugin.<br>加载插件需要一个兼容的 DeepSeek Harness checkout。
- The reviewed live-smoke contract uses Node.js 24.x, pnpm 11.7.0, and the exact revision in [reference/harness-compatibility.json](reference/harness-compatibility.json).<br>经审阅的 live smoke 合同使用 Node.js 24.x、pnpm 11.7.0，以及 [reference/harness-compatibility.json](reference/harness-compatibility.json) 中的 exact revision。

### Load the plugin from a source checkout / 从源码 checkout 加载插件

The repository is public and distribution remains source-first. `package.json` keeps `private: true` to prevent npm publication. Build the local checkout, then add it to a Harness profile. The GitHub repository is named `dsh-repo-atlas`; the product brand remains `RepoAtlas`, and the package and visible Harness bundle are named `dsh-repo-atlas` and `dsh-repo-atlas/harness`.<br>
仓库已公开，分发仍采用源码优先；`package.json` 保留 `private: true` 以防止 npm 发布。先构建本地 checkout，再将其添加到 Harness profile。GitHub 仓库名为 `dsh-repo-atlas`；产品品牌仍为 `RepoAtlas`，包名和 Harness 中显示的 bundle 名称分别是 `dsh-repo-atlas` 与 `dsh-repo-atlas/harness`。

```bash
git clone https://github.com/zhenkun26/dsh-repo-atlas.git
git clone https://github.com/deepseek-ai/deepseek-harness.git

cd /absolute/path/to/dsh-repo-atlas
npm ci
npm run build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm dsh plugin --profile web add /absolute/path/to/dsh-repo-atlas
pnpm dsh web
```

In the Harness Web UI, look for `dsh-repo-atlas/harness` in the plugin list. The bundle patch loads the adapter; it does not modify Harness core.<br>
在 Harness Web UI 的插件列表中，应看到 `dsh-repo-atlas/harness`。bundle patch 只负责加载适配器，不会修改 Harness 核心。

### Run local checks / 运行本地检查

```bash
cd /absolute/path/to/dsh-repo-atlas
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:built-artifact
npm run evaluate:repository
```

Builds first create a fresh package under ignored `.codex/artifacts/build-*` and retain it on success or failure. Normal build then updates root `dist/`; unexpected prior files or symlinks stop that projection. Use `npm run build -- --isolated` to build a separate package without projecting root `dist/`; its printed package path can be loaded into Harness. Artifacts are retained for inspection and require user-managed cleanup.<br>
构建先在 ignored `.codex/artifacts/build-*` 下生成独立 package，成功或失败均保留。普通构建随后更新根目录 `dist/`；发现不属于本次构建的旧文件或符号链接时会停止写入。可用 `npm run build -- --isolated` 生成独立 package，不更新根目录 `dist/`；输出的 package 路径可以加载到 Harness。产物保留供检查，清理需由用户管理。

`verify:built-artifact` packs only a fresh isolated package, installs it offline into a new consumer with lifecycle scripts disabled, and imports `dsh-repo-atlas` and `dsh-repo-atlas/harness`. It retains all outputs and provides local artifact evidence, not npm publication.<br>
`verify:built-artifact` 仅打包新的独立 package，禁用 lifecycle scripts 后在全新 consumer 中离线安装，并 import `dsh-repo-atlas` 与 `dsh-repo-atlas/harness`。它保留全部产物，只提供本地产物证据，不代表 npm 发布。

`evaluate:repository` records default-budget precision/recall and coverage using a [synthetic labelled corpus](evaluation/README.md). Low-recall results remain visible; the labels are pending human review.<br>
`evaluate:repository` 使用[合成标注语料](evaluation/README.md)记录默认预算下的精确率、召回率和覆盖状态，保留低召回结果；标签仍待人工审阅。

Maintainers can run the full repository gates with:<br>
维护者可以运行完整仓库门禁：

```bash
npm run validate:openspec
npm run verify:release-preflight
git diff --check
```

These checks are read-only candidate checks. They do not create patches, tags, releases, npm publications, pushes, deployments, or cleanup operations.<br>
这些检查是只读的候选检查，不会创建补丁、tag、release、npm publication、push、deployment 或 cleanup。

## How it works / 工作方式

The normal analysis path is deliberately explicit:<br>
普通分析路径保持显式：

```text
Goal → Clarify → Policy Gate → Bounded Read-only Analysis → Verify → Report
目标 → 澄清 → Policy Gate → 有界只读分析 → 验证 → 报告
```

For change-oriented work, the session can expose additional lifecycle observations:<br>
对于变更相关工作，session 还可以提供额外的生命周期观察：

```text
Proposal → Patch Review → Verification → Isolated Commit → Landing Preflight → Release Preflight
提案 → 补丁审阅 → 验证 → 隔离 Commit → Landing Preflight → Release Preflight
```

These names describe separate states. A proposal, preflight, or readiness assessment is not proof that code was generated, applied, committed, landed, released, or published.<br>
这些名称描述的是相互独立的状态。proposal、preflight 或 readiness assessment 不代表代码已经生成、应用、commit、landing、release 或 publish。

## Safety boundaries / 安全边界

| Area / 范围 | Behavior / 行为 |
| --- | --- |
| Core analysis<br>核心分析 | Read-only inspection with path, content, sensitive-file, and resource-budget policies.<br>遵守路径、内容、敏感文件和资源预算策略的只读检查。 |
| Session state<br>Session 状态 | Evidence cache, proposal registry, event history, and preflight assessments are session-only and detached.<br>evidence cache、proposal registry、event history 和 preflight assessment 仅限当前 session，并以 detached 观察返回。 |
| Controlled actions<br>受控动作 | Disabled by default; when enabled, fixed recipes, explicit approval, sandbox enforcement, and bounded redacted output are required.<br>默认关闭；启用后必须使用固定 recipe、显式审批、sandbox 强制和有界脱敏输出。 |
| Git lifecycle<br>Git 生命周期 | Isolated local operations are bounded; automatic conflict resolution, remote access, rollback, and push are not provided.<br>隔离本地操作保持有界；不提供自动冲突解决、远程访问、rollback 或 push。 |
| Network and dependencies<br>网络与依赖 | The runtime does not fetch repositories, call remote services, install dependencies, or upload code.<br>运行时不抓取仓库、不调用远程服务、不安装依赖、不上传代码。 |
| Failure behavior<br>失败行为 | Missing capabilities, denied approval, invalid input, budget exhaustion, and uncertain postconditions fail closed or remain explicitly partial.<br>能力缺失、审批拒绝、输入无效、预算耗尽和不确定 postcondition 会故障关闭，或明确保留为 partial。 |

## Compatibility and support / 兼容性与支持

- Local development baseline: **Node.js 22+**.<br>本地开发基线：**Node.js 22+**。
- Default CI matrix: **Node.js 22.x and 24.x**.<br>默认 CI 矩阵：**Node.js 22.x 和 24.x**。
- Reviewed live Harness smoke: **Node.js 24.x**, **pnpm 11.7.0**, and revision [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a).<br>经审阅的 live Harness smoke：**Node.js 24.x**、**pnpm 11.7.0** 和 revision [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)。
- The moving `master` branch is navigation context only; the exact manifest revision is the evidence contract.<br>变化中的 `master` 分支仅用于导航；manifest 中的 exact revision 才是证据合同。
- Support is best-effort and has no SLA. Compatibility with arbitrary Harness versions is not claimed.<br>支持为 best-effort，不提供 SLA；不声称兼容任意 Harness 版本。

Read the [support policy](docs/support-policy.md) and [Harness compatibility manifest](reference/harness-compatibility.json) before integrating the plugin into another workflow.<br>
将插件集成到其他工作流前，请阅读 [support policy](docs/support-policy.md) 和 [Harness compatibility manifest](reference/harness-compatibility.json)。

## Distribution and license / 分发与许可证

The package remains `private: true` and source-first. The local built tarball is useful for diagnosis and integration checks, but it is not a published npm package. Git tags, GitHub Releases, npm publication, and deployment are separate decisions.<br>
包仍保持 `private: true`，并采用源码优先分发。本地 built tarball 可用于诊断和集成检查，但不是已发布的 npm 包。Git tag、GitHub Release、npm publication 和 deployment 是相互独立的决策。

The existing `v0.1.1` GitHub Release remains an earlier source-first snapshot. The current checkout can produce a verified local tarball, but no npm package or new GitHub Release is implied; historical `v0.1.0` and `v0.1.1` tags remain immutable.<br>
现有 `v0.1.1` GitHub Release 仍是较早的 source-first 快照。当前 checkout 可以生成经验证的本地 tarball，但不代表存在 npm 包或新的 GitHub Release；历史 `v0.1.0` 和 `v0.1.1` tag 保持不可移动。

RepoAtlas is released under the [MIT License](LICENSE). Use, modification, and redistribution are allowed when the MIT copyright notice, license text, and disclaimer are retained.<br>
RepoAtlas 使用 [MIT License](LICENSE) 发布。保留 MIT 版权声明、许可证文本和免责声明后，允许使用、修改和再分发。

When citing, integrating, documenting, or deriving from this project, please identify **RepoAtlas / 代码星图** and link to <https://github.com/zhenkun26/dsh-repo-atlas>. This provenance request is recorded separately in [NOTICE.md](NOTICE.md) and does not add legal conditions to the MIT License.<br>
在引用、集成、文档说明或基于本项目衍生时，请标注 **RepoAtlas / 代码星图** 并链接 <https://github.com/zhenkun26/dsh-repo-atlas>。这项来源说明单独记录在 [NOTICE.md](NOTICE.md) 中，不会向 MIT License 增加额外法律条件。

## Development API / 开发 API

The core API can be used from a source checkout for experiments and tests:<br>
核心 API 可以从源码 checkout 调用，用于实验和测试：

```ts
import { createGoalSpec, resolveStart, analyzeRepository, generateReport } from './src/index.ts'

const goal = resolveStart(createGoalSpec({ intent: 'onboarding' }), 'direct')
const session = await analyzeRepository(goal, '/path/to/workspace')
const report = generateReport(session)

console.log(report.markdown)
```

The same evidence, path, sensitive-content, and budget policies apply. Raw TypeScript package loading is not the built artifact contract.<br>
这里仍遵守相同的证据、路径、敏感内容和预算策略。原始 TypeScript package loading 不属于 built artifact 合同。

## Documentation / 文档导航

- [Harness integration / Harness 集成](docs/harness-integration.md)
- [Security boundary / 安全边界](docs/security-boundary.md)
- [Support policy / 支持策略](docs/support-policy.md)
- [Source-first release process / 源码优先发布流程](docs/release-process.md)
- [Public release checklist / 公开发布清单](docs/release-checklist.md)
- [Roadmap and limitations / 路线与限制](docs/roadmap.md)
- [v1 usage / v1 使用说明](docs/v1-usage.md)
- [Contributing / 贡献指南](CONTRIBUTING.md)
- [Security reports / 安全报告](SECURITY.md)
- [Code of conduct / 行为规范](CODE_OF_CONDUCT.md)
- [Attribution notice / 来源说明](NOTICE.md)
