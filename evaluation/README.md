# Repository intelligence evaluation / 仓库理解评测

This corpus measures the current bounded analysis and query behavior. Source inputs
live under `corpus/*/repository`; labels live in `labels.json` outside those roots.
Two stress cases are materialized in a fresh retained `.codex/evaluation/run-*`
directory on each run. No repository code is executed and no files are deleted.

本语料用于测量当前有界分析和查询行为。源码输入位于 `corpus/*/repository`，
标签位于扫描范围之外的 `labels.json`。两个压力样例每次在新的
`.codex/evaluation/run-*` 目录生成并保留，不执行语料代码，不删除文件。

```sh
npm run evaluate:repository
```

Each report records source/input/label/evaluator/gate-module hashes, Node and platform, default
budgets, measured results and elapsed time. Reports are preserved, including cases
with low recall. A zero exit code checks for false resolved edges, snapshot-reference
integrity, redaction, sensitive-path exclusion, and expected budget status; it does not mean every query or graph is complete.

每份报告记录源码、输入、标签和评测器的哈希、Node 与平台、默认预算、结果和耗时。
低召回结果也会保留。退出码为零仅表示未出现误解析依赖边、快照引用完整性、脱敏、敏感路径排除及预期预算状态符合要求，
不代表每个查询或依赖图完整。

| Case / 样例 | Purpose / 用途 |
|---|---|
| cycle | Static imports, barrel re-export, cycle, test dependent / 静态导入、重导出、循环、测试依赖 |
| unresolved | Alias, missing target, dynamic import and false exported path / 别名、缺失目标、动态导入、导出字符串误判 |
| unsupported | Python text retrieval with explicitly unsupported graph relations / Python 文本检索及不支持的图关系 |
| budget-chain | 72 files exceed search/action/AST defaults / 72 个文件超出搜索、动作和 AST 默认范围 |
| retained-text | Query marker beyond retained 8,000-character text / 查询标记位于保留文本的 8,000 字符之外 |
| sensitive | Synthetic sensitive path and redaction / 合成敏感路径与脱敏 |
| application | Mixed TS/JS routing, service, utility and test imports / 混合 TS/JS 路由、服务、工具与测试依赖 |
| monorepo | Cross-workspace imports, re-exports, aliases, package names and unknown target / 跨工作区导入、重导出、别名、包名与未知目标 |

Retrieval recall uses unique source paths from the existing top ten **evidence
records**. Graph recall covers labelled static resolvable edges. Impact recall
compares against the full labelled affected set while using default depth 3 and
limit 50. Empty denominators are `null`, not perfect scores. Citation validity here
means references resolve inside the retained snapshot, not line-content freshness.

检索召回率使用现有前十条**证据记录**去重后的文件路径；图召回率针对标注的可解析
静态关系；影响召回率使用默认深度 3 和上限 50，对照完整标注影响集合。
分母为空时记为 `null`，不计为满分。引用完整性只针对保留快照，不证明行内容新鲜度。

Labels and source were independently authored as synthetic fixtures before running
the evaluator. Their provenance is `agent-authored-synthetic-ground-truth` and
`human-review-pending`. They are regression/evaluation inputs, not evidence of a
human-reviewed benchmark or real-repository generalization. Do not change labels
to match observed outputs.

标签和源码在执行评测前作为合成样例独立编写，来源标注为 agent 编写、待人工审阅。
它们不能代表人工审核基准或真实仓库的泛化效果；不得为匹配算法输出而调整标签。

The [R1 default-budget baseline](baselines/r1-defaults-2026-10-04.json) preserves the
first delivery's measured behavior. The cycle case reaches full labelled recall;
the 72-file chain reaches 15/71 edge recall with budget exhaustion, and its tail
query and impact target have zero recall. The retained-text query also has zero
recall. These are known limitations to measure during R3, not failed fixture setup.

[R1 默认预算基线](baselines/r1-defaults-2026-10-04.json) 保留本次交付的实测行为。
循环样例的标注召回完整；72 文件链的边召回为 15/71，并报告预算耗尽，末端查询与
影响目标的召回均为零；保留文本边界查询的召回也为零。这些是 R3 要复测的已知限制，
不是语料准备失败。


The [R3 source-snapshot baseline](baselines/r3-source-snapshots-2026-10-04.json)
keeps the same independent labels and numeric budgets. Retained-text recall improves
from 0/1 to 1/1. The 72-file chain remains at 15/71 edges, tail query 0/1 and
impact 0/71. Search now prefers distinct files; the unique-file recall calculation
is unchanged. The evaluator's redaction gate additionally covers retained source
material. Source and evaluator hashes are recorded separately from the R1 run.
`readBytes` is the conservative budget charge for bounded attempts, including
attempts that fail after backend reading; it is not a transport-byte counter.

[R3 源码快照基线](baselines/r3-source-snapshots-2026-10-04.json) 使用同一独立标签和数值预算。
长文本召回从 0/1 提升到 1/1；72 文件链仍为 15/71 条边，末端查询 0/1，影响召回 0/71。
搜索优先返回不同文件，去重文件召回公式保持不变。评测器新增完整保留材料的脱敏门禁，
源码与评测器哈希与 R1 分开记录。`readBytes` 是有界读取尝试的保守预算计费，
包括后台读取后失败的尝试，不等同于传输字节计数。

The [native-output follow-up baseline](baselines/runtime-json-output-2026-10-05.json)
records the final source hash after the lossless-JSON adapter fix. The same six
independent labels and numeric budgets retain the R3 recall results; earlier
baselines are preserved. Labels still require human review.

[原生输出修复基线](baselines/runtime-json-output-2026-10-05.json) 记录严格 JSON 适配修复后的
最终源码哈希。同一组六个独立标签和数值预算保持 R3 召回结果，历史基线完整保留；
标签仍待人工审阅。


The [application and monorepo baseline](baselines/application-monorepo-2026-10-07.json)
adds two independently authored synthetic cases. Both opt into
`expectCompleteCoverage`: missing labelled edges, relevant retrieval files,
affected files, unexpected affected files, truncated impact or an unresolved-set
mismatch fail the command. `expectedUnknownTargets` checks exact unknown targets.
All cases additionally require valid graph references and exclude explicitly
labelled unsupported relations. The original six cases keep their measured metrics
without new recall minima. CI runs this command on Node 22/24.

[应用与 monorepo 基线](baselines/application-monorepo-2026-10-07.json) 增加两例独立编写的合成语料。
两例显式启用完整静态快照门禁：漏掉标注依赖、检索文件、影响文件，出现额外影响文件、
截断影响结果或未解析导入集合不匹配均使命令失败；未知目标须精确匹配。
所有样例另检查图引用和显式不支持关系；原六例不增加召回下限，保留原实测指标。
CI 在 Node 22/24 执行此命令。别名和包名仍不解析，标签仍待人工审阅；
合成样例完整召回不代表真实项目、运行时影响、LSP/UI 或 Windows 验收。
