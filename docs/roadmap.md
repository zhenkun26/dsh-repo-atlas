# 限制与后续路线

## 2026-10 重规划与当前交付

产品方向已确定为 Harness 原生的代码理解、证据检索和变更影响分析插件。
新的优先级与验收标准见 [October replanning](replanning-2026-10.md)；下方版本记录保留为历史证据。

- R1 已本地实现：独立依赖图模块、严格导入解析、parser provenance、会话内 `repo_atlas_search` 与 `repo_atlas_impact`；既有变更生命周期保留。
- 当前上游已重新克隆并审查：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`（`0.2.1-alpha.1`）。源码审查不等于官方类型编译、Loader/Web 启动或人工验收通过；已验收 pin 保持不变。
- R2a/R2b 已本地实现：免删除构建、隔离打包与离线 consumer 验证，以及独立标注的合成评测语料和默认预算基线。R2c 的 exact candidate 验收及只读 reader 适配仍待推进；R3：证据新鲜度和检索质量；R4：可选 LSP 符号级分析；R5：旧生命周期模块分离及产品打磨。
- 外部评审采纳结果已写入重规划：允许提前评估独立的 Git adapter/无状态 helper 拆分；动态工具可见性列入 R3/R4 观察项；正式 supported pin 默认等待 stable 并通过完整验收，alpha 适配及独立质量工作继续推进。README public/private 问题已在 `71e3231` 解决。
- 本轮 90 个所选测试、类型检查、现有 lint、常规 build/prepack 与 fresh packed artifact 离线导入通过；8 个涉及删除的旧测试仍未执行。OpenSpec CLI、当前上游编译/启动、人工查询和 Windows 验收仍是独立门禁。
- 合成循环样例召回完整；72 文件链的依赖边召回为 15/71，报告预算耗尽，末端检索/影响召回为零；保留文本边界查询也为零。标签待人工审阅，结果不能代表真实仓库效果，预算未调整。
- R1 与规划修订已推送至 `refactor/repository-intelligence`（`71e3231`、`9ee21f9`）；本轮 R2a/R2b 为新的本地增量。详细结果见 [R2 tasks](../openspec/changes/non-deleting-validation-and-evaluation/tasks.md)，历史结果见 [R1 tasks](../openspec/changes/repository-intelligence-foundation/tasks.md)；未发布。

## 不属于 v1

- 受控命令执行、测试/构建运行和自动修复。
- 网络抓取、远程仓库访问和第三方服务连接。
- 自动写回用户代码库、提交或推送 Git。
- 完整语言 AST、运行时调用图和跨仓库依赖图。
- 常驻数据库、跨 session 增量索引和团队协作权限模型。

## 后续版本建议

1. v1.1（已完成）：在明确授权和沙箱中增加受控 recipe 执行，并把命令、参数、输出和审批结果纳入 Harness 审计链；标准 sandbox Web 成功路径与 no-sandbox fail-closed 路径均已验收。
2. v1.2（已完成 OpenSpec 边界）：加入仅限 session 的增量地图与 evidence cache，只重新读取新增、变化、metadata 不可用或被追问覆盖的范围；缓存不持久化、不跨 session、不联网，metadata 新鲜度限制已记录。
3. v1.3（已完成）：按语言接入受安全边界和预算约束的 TypeScript/JavaScript 语法确认，区分“文本推测”和“语法确认”的关系；AST evidence 仅限当前 session，并与 metadata cache 共同失效。
4. v2（已完成）：在独立工作树中提供用户确认后的代码变更提案，仍然默认不提交、不推送；提案状态、worktree 生命周期和证据引用限制在当前 session，不自动生成或应用补丁。
5. v2.1（已完成并归档）：接收用户或宿主显式提供的有界 unified diff，在 confirmed proposal 的隔离 worktree 中经过二次 digest 确认后应用；继续禁止 source workspace 写入、自动回滚、commit、push、部署、依赖安装和网络访问。
6. v2.2（已完成）：对已准备或已应用的 patch 提供 session-only review/export；在 Harness Goal、一次性 approval、read-only recipe、sandbox 和 subprocess 约束下，对隔离 worktree 执行一次受控验证并记录 bounded、redacted result。继续禁止 patch 生成、source workspace 写入、commit、merge、push、部署、依赖安装、网络和自动清理。
7. v2.3（已完成）：对已应用且 verification=passed 的 patch 提供 session-only isolated-worktree commit draft；commit 必须经过 exact digest、active+armed Goal 和一次性 Harness approval，只能对声明路径执行固定本地 Git staging/commit，并在 postcondition 不确定时保留 worktree。继续禁止 source workspace 写入、merge、push、远程访问、hooks、GPG signing、author override、部署、依赖安装和自动清理。
8. v2.4（已完成）：对 v2.3 已创建的 session-owned commit 提供独立 source landing draft；只允许 source workspace clean、HEAD exact base revision 下的固定 `merge --ff-only` fast-forward，并要求二次 digest、active+armed Goal 和一次性 Harness approval。继续禁止冲突解决、merge commit、branch 操作、remote、push、回滚和自动清理。
9. v2.5（已完成）：提供按 proposal id 的 session-only lifecycle inspection，返回 bounded、redacted 的 proposal/patch/verification/commit/landing 快照和非执行状态；不刷新 Git、不读取 workspace、不请求审批、不改变 lifecycle。
10. v2.6（已完成）：提供固定上限、newest-first 的 session-only proposal summary listing，支持发现 proposal id 后继续 inspect；不返回路径、evidence、digest、patch text、commit message 或 worktree，不刷新 Git，不跨 session。
11. v2.7（已完成）：提供 source workspace 与 session-owned worktree 的只读 live-state inspection，区分 available/partial/unknown/not-applicable，并保留 creation-unknown 与其他 lifecycle 状态；不写 Git、不修复、不改变 registry、不持久化。
12. v2.8（已完成）：提供 bounded、脱敏、session-only 的 proposal lifecycle event history，记录实际状态转移及 blocked/interrupted/uncertain 结果；history 只读、不刷新 Git、不持久化、不跨 session。
13. v2.9（已完成）：提供 session-only `inspect-recovery` guidance，将 proposal registry 状态映射为 bounded 的下一步建议和 manual-review-required/no-action 结论；不执行 recovery、不刷新 Git、不授权、不持久化。rollback、reset、revert、merge、冲突解决、force cleanup 和团队协作索引仍不属于本版本。
14. v2.10（已完成）：提供 session-only `inspect-landing` preflight，使用固定本地 Git read-only inspection 区分 fast-forwardable、already-landed、source-ahead、diverged、dirty、revision drift、target unavailable 和 unknown；不执行 landing、merge、冲突解决、rollback、cleanup、remote 或 push，也不把观察结果视为授权或已完成。
15. v2.11（已完成）：提供 session-only `inspect-release` readiness observation，使用现有 worktree read-only inspection 区分 not-applicable、ready、proposal-state-blocked、worktree-dirty、identity-mismatch 和 unknown；不执行 release、remove、cleanup、approval、Git mutation 或持久化，也不把 ready 观察结果视为 release 已完成或授权。
16. v2.12（已完成，开源化基线）：增加 MIT 工作许可证、贡献/行为/安全/变更文档、源码优先分发说明、release checklist 和 Node.js 22/24 GitHub Actions 门禁；保持 `private: true`，不发布 npm、不生成编译产物、不创建 tag/release，不改变任何 session-only runtime boundary。
17. v2.13（已完成）：确定继续 source/plugin bundle first；增加 clean-checkout + local packed-install evaluation，明确 tarball 不等于 npm consumer import；固定公开 DeepSeek Harness revision `47f943859bef60e4160492346772ded9b24f765a`、Node 24.x 和 pnpm 11.7.0，提供 shell-free compatibility runner 与仅 `workflow_dispatch` 的真实 Harness smoke workflow；该 public pin smoke 已实际通过。外部 clone/install 仍不进入 runtime 或默认 CI。
18. v2.14（已完成，需独立 release 授权）：增加 proposed support policy、source-first 首次 release procedure、read-only `verify:release-preflight` 和 manual release-preflight workflow；preflight 只观察候选状态，不创建 tag、GitHub Release、npm publication、push 或 deployment。版权持有人确认、release notes 和实际 release 仍是人工 gate。
19. v2.15（已完成）：优化开源项目展示，补充安全优先、证据驱动和 source-first 的项目描述、README landing 内容与 package description；不改变 runtime、npm 或 release side effect 边界。
20. v2.16（已完成）：将 README 的主要评估、安装、安全、兼容性、分发和治理路径改为中英双语；共享命令、路径、链接和 revision，避免技术事实漂移。
21. v2.17（已实现，`v0.1.1` source-first GitHub Release 已完成）：对齐 `0.1.1`、不可变 `v0.1.0` 历史 tag、双语 release status、CHANGELOG、release checklist 和手动 GitHub About metadata handoff；tag/Release 通过独立人工授权完成，RepoAtlas tooling 不自动执行；npm 仍未发布。
22. v2.18（已实现）：从每次 Harness tool execution 的 exact live session 解析 absolute `header.cwd` 和 caller `AbortSignal`，按 session object 隔离 config、evidence cache、proposal manager、event history 与 advisory assessment；不再使用插件 mount 时的 `process.cwd()` 作为默认分析目录。缺失、取消、cwd 漂移或 configured-root 不匹配均在 I/O、Git adapter、approval 和 subprocess 之前 fail closed，不新增持久化、跨 session、网络或发布能力。
23. v2.19（已实现，增强 live smoke 待独立 workflow 复核）：增加 exact-public-pin 官方声明编译合同，覆盖 ToolDefinition、ToolRunContext、Context、approval、Goal、sandbox-policy、sandbox 与 subprocess；sandbox policy 改用 `{session, mode}` 并在执行前复核 root/mode。手动 smoke 改为 ephemeral loopback Web boot、post-settlement readiness、HTTP probe 和 owned child termination；本地 ahead checkout 只产生 fail-closed 负向证据，不替代公开 pin workflow 成功记录。
24. v2.20（已实现，未发布）：提供不依赖 Harness 源码 TS loader 的 built package/tarball 路径，生成 ignored `dist/` ESM/declarations，使用最小 `files`/conditional exports，并通过 offline packed-install 与 plain Node root/Harness import 验证。`private:true` 保留，本地 build/tarball readiness 不等于 `npm publish`、tag、GitHub Release 或 deployment，实际发布仍需独立授权。
25. v2.21（已实现并通过 exact-pin contract）：修复 sandbox-policy facade 对官方完整 `SandboxMode` vocabulary 的结构兼容；`danger-full-access` 只进入类型边界，RepoAtlas controlled action 与 patch verification 仍在 sandbox/subprocess 前 fail closed，不扩大 recipe、approval 或 runtime 权限。
26. v2.22（已实现并通过 manual workflow）：修复增强 live smoke 的 pinned Harness 构建前置条件，workflow 改用官方根 `pnpm run build` 生成 host、client 与 Web frontend outputs 后再启动 `dsh web`；仍保持 `workflow_dispatch`、`contents: read`、exact pin、bounded loopback probe 与 owned-process cleanup。[run 31895791477](https://github.com/zhenkun26/dsh-repo-atlas/actions/runs/31895791477) 在 `47f943859bef60e4160492346772ded9b24f765a` 上通过。

每个版本都应先更新安全边界、预算、部分失败语义和验收 fixture，再扩展工具权限。OpenSpec sync/archive、commit/push、npm publication 与实际 tag/Release 操作始终是独立的审阅边界。
