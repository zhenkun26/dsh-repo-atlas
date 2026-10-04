# Harness 集成说明

RepoAtlas 适配器位于 `src/harness/plugin.ts`。它导出 `name = "dsh-repo-atlas"`、`inject = ["tools"]` 和 `apply(ctx)`，并通过公开的 `ctx.tools.register(...)` 注册 `repo_atlas_analyze` 与 `repo_atlas_change_proposal`。后者支持 proposal lifecycle、v2.11 的只读 `inspect-release` readiness、v2.10 的只读 `inspect-landing` preflight、v2.9 的 read-only `inspect-recovery`、v2.8 的 session-only `history`、v2.7 的 read-only `inspect-live`、v2.6 的 bounded session-only `list`、v2.5 的 session-only `inspect`、`prepare-patch`、`review-patch`、`export-patch`、`confirm-patch`、`reject-patch`、`verify-patch`、v2.3 的 `prepare-commit`、`confirm-commit`、`reject-commit`，以及 v2.4 的 `prepare-landing`、`confirm-landing`、`reject-landing`。只有配置显式启用 `controlledActions` 时，才额外注册 `repo_atlas_controlled_action`。

包根目录同时声明了 `dsh.bundle` 和 `cordis.patch.yml`，因此可以作为 profile bundle 安装；patch 会加载 `dsh-repo-atlas/harness`，而不是修改 Harness 核心。工具声明了 Harness 要求的规范 `output.schema` 和文本渲染器，避免只在 fake context 中注册成功、在真实 Loader 中因缺少 canonical output 失败。

适配器把业务逻辑留在 `src/` 的 session-only 模块中，Harness 只负责 session、审批与工具生命周期。受控动作和 patch verification 通过 `ctx.get()` 读取公开的 `approval`、`goals`、`sandboxPolicy`、`sandbox` 和 `subprocess` 能力；verification 的执行 root 由 session-owned worktree 提供，不能由工具输入覆盖。v2.3 commit authorizer 与 v2.4 landing authorizer 只读取 `goals` 与 `approval`，要求 active+armed Goal、live agent、tool call id 和一次性 `allowed-once`，不直接执行 Git。landing 的 source path、base revision 和 target revision 由 session manager 派生，工具输入不能覆盖。任何能力缺失、recipe 非 read-only、resolved root 不匹配或 approval 被拒绝都保持工具可见但执行故障关闭。接入已安装的 Harness 时，在 Harness checkout 中执行：

v2.18 起，所有读取或操作 workspace 的工具都从当前调用的 `execution.agent.session.header.cwd` 解析 absolute root，并接收该调用的 `AbortSignal`。`workspaceRoot` 配置仅是可选的 exact restriction，不是 session cwd fallback。每个 exact Harness session object 拥有独立的 config 和 proposal manager；即使 cwd 相同，也不会共享 evidence cache、proposal registry、event history 或 lifecycle state。缺失 execution/session/cwd/signal、预先取消、root 不匹配或 session cwd 漂移时，会在 repository I/O、adapter、approval 和 subprocess 前 fail closed。

```bash
pnpm dsh plugin --profile web add /absolute/path/to/RepoAtlas
pnpm dsh web
```

然后在 Web UI 的“设置 → 插件 → 插件列表”中应看到 `dsh-repo-atlas/harness` 为“已挂载、已启用”。未确认的 GoalSpec 仍只返回澄清问题，不启动扫描；受控动作和 patch verification 还需要 active+armed Goal 和一次性用户审批。patch export 只返回当前 session result，不写导出文件；`inspect` 只返回当前 session memory 的 detached proposal snapshot，`list` 只返回 bounded summary，`history` 只返回当前 manager memory 中实际状态转移的 bounded detached events，`inspect-recovery` 只从 registry 返回下一步建议，不是授权或执行，`inspect-live` 只读取本地 source/worktree 状态并返回独立 observation，`inspect-landing` 只读取已创建 local commit 与 source 的 bounded 本地关系并返回 preflight observation，`inspect-release` 只读取当前 proposal 的 release 相关状态与 session-owned worktree 的 bounded read-only facts，并返回 advisory readiness observation，不刷新 registry、不请求审批、不执行写操作。插件没有声明自由 Shell、网络、安装、写入源 workspace、commit、merge 或 Git push 工具。

环境适配反馈：官方 Web profile 的 `bash-sandbox` 和 permission preset 依赖 `sandbox` 能力。只禁用 `sandbox` 会让依赖链在启动阶段保持 pending 并 fail closed，无法进入可执行 session；这属于 Harness 组合适配限制，而不是 RepoAtlas 动作逻辑应绕过的安全边界。验收时采用了隔离的最小无 shell 组合：同时停用 `sandbox`、`bash-sandbox`、`permission`、`tool-bash`，保留 `subprocess`、`sandbox-policy`、`approval`，并挂载只含 persona 与 Goal 工具的自定义 agent preset。该组合可以启动真实 Web session；在 active+armed Goal 和 `allowed-once` 审批后，动作返回 `sandbox-unavailable` 且 stdout 为空，保持 fail-closed、未进入 spawn。v2.3 commit 不依赖 sandbox subprocess，v2.4 landing 只调用内部固定 Git adapter，但二者仍依赖同一 Harness Goal/approval 约束。默认 profile 未修改。

## 公开分发边界

RepoAtlas 当前从 checkout 构建后加载：先运行 `npm ci` 与 `npm run build`，再由根目录 `cordis.patch.yml` 加载 `dsh-repo-atlas/harness` 的 built export。构建先生成新的 `.codex/artifacts/build-*/package`，再检查并更新根目录 `dist/`；旧文件或符号链接会阻止这一步。`npm run build -- --isolated` 只生成独立 package，可将打印出的 package 路径加入 Harness profile。`npm run verify:built-artifact` 仅打包新的独立 package，验证 `dist/` ESM/declarations、最小 files allowlist、offline tarball install，以及 plain Node root/Harness imports；tarball 不含 raw `src/`，consumer 禁用 lifecycle scripts。构建、tarball、consumer 与失败记录全部保留。该能力仍保持 `private:true`，不执行或暗示 npm publish。

真实 Harness 兼容目标固定在 [reference/harness-compatibility.json](../reference/harness-compatibility.json)：公开仓库 `deepseek-ai/deepseek-harness` 的 `master` 分支仅作导航，`47f943859bef60e4160492346772ded9b24f765a` 才是验收 revision，配套 Node 24.x 与 pnpm 11.7.0。忽略的 `reference/deepseek-harness/` 是用户本地 checkout；只有 HEAD 与该 revision 完全一致时才可作为本地 smoke 输入，ahead/diverged checkout 必须 fail closed。

在满足 pin 且已通过 Harness 根 `pnpm run build` 生成 host、client 与 Web outputs 的 checkout 中，可在 RepoAtlas 根目录运行 `REPO_ATLAS_HARNESS_ROOT=/absolute/path/to/deepseek-harness npm run verify:harness-api-contract`，验证 RepoAtlas facade 对官方 ToolDefinition、ToolRunContext、Context、approval、Goal、sandbox-policy、sandbox 与 subprocess declarations 的 assignability。sandbox-policy facade 覆盖官方完整 `SandboxMode` vocabulary 仅用于结构兼容；RepoAtlas runtime 仍只接受 `read-only`/`workspace-write` resolved policy，并在 `danger-full-access` 或未知 mode 下于 sandbox/subprocess 前 fail closed。该检查拒绝 tracked dirty 或 revision drift，不把本地手写类型单独视为证据。

`REPO_ATLAS_HARNESS_ROOT=/absolute/path/to/deepseek-harness npm run verify:harness-compatibility` 使用固定 `pnpm` argv、`shell:false`、filtered environment 和 task-owned 临时 `DSH_HOME`。手动 workflow 必须先完成 pinned Harness 根 `pnpm run build`，不能用 host-only build 代替 Web frontend output；runner 随后验证 `plugin add`、`--dump-config`、官方 API contract，并实际启动 `dsh web --port 0`。只有观察到 post-settlement `dsh web:` loopback readiness、完成 bounded HTTP probe 并终止 owned child 后才通过。help/config/module import 单独不再算 activation evidence。对应 workflow 仍只有 `workflow_dispatch` 和 `contents: read`；默认 PR/push CI 不 clone、安装、构建或启动外部 Harness。

fake-context tests 与 exact-pin API compile pass 证明不同层次的契约，但都不等价于 live Loader activation。v2.22 修复后的 [manual workflow run 31895791477](https://github.com/zhenkun26/dsh-repo-atlas/actions/runs/31895791477) 已在 exact pin 上完成 root build、official API contract、live loopback probe 与 owned-process cleanup；该运行是当前 live activation 证据，但仍不等于 npm publication、tag、GitHub Release、deployment 或额外 runtime 授权。

## 2026-10 证据查询与新版上游审查

默认注册四个工具：`repo_atlas_analyze`、`repo_atlas_search`、`repo_atlas_impact` 和原有 `repo_atlas_change_proposal`。两个新增查询的实现见 `src/harness/intelligence-tools.ts`；查询需要当前 exact session 已完成分析，且继续通过 cwd、AbortSignal 和配置 root 校验。

`repo_atlas_search` 接收 query 和 1–50 的 limit；`repo_atlas_impact` 接收 1–50 个仓库相对路径、1–10 的 maxDepth 和 1–100 的 limit。返回的 freshness 为 `snapshot-not-revalidated`，不会新增文件读取、Git、审批或 subprocess。source 变化后需重新调用 analyze；有限图上的空结果不代表无影响。

当前重新拉取的上游为 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，审查记录见 [harness-upstream-review.json](../reference/harness-upstream-review.json)，迁移计划见 [replanning](replanning-2026-10.md)。现有 accepted manifest 和手动 workflow pin 保留，不能把新的源码审查当作旧验收 pin 已自动升级。
