# RepoAtlas repository intelligence plan

Assessment date: 2026-10-04 (America/New_York). Baseline: RepoAtlas
`e4cd2ac88bd6631445ba3db13de4cc8d382337eb`. Product decision: remain a DeepSeek
Harness plugin, prioritizing code understanding, evidence retrieval, and change
impact analysis. This document supersedes the feature priorities in the historical
roadmap; it does not supersede its historical acceptance records.

## Assessment

RepoAtlas has a useful foundation: bounded scanning, secret-like redaction,
source-linked evidence, session isolation, cancellation, and explicit uncertain
outcomes. Preserve these properties. The current center of complexity has moved
away from repository understanding: `src/repository/change-proposal.ts` has 2,056
lines in the baseline, compared with 367 in `analyze.ts`. It combines proposal,
patch, verification, commit, landing, inspection, and Git adapter behavior.

Baseline findings from the source review (resolution status updated after R1):

| Priority | Finding | Consequence | Decision |
|---|---|---|---|
| P1 | Import resolution used `files.find` with filename/directory prefixes | An import could point to an unrelated child or a similarly named file | Resolve exact observed files and unambiguous extension/index candidates |
| P1 | Structural export parsing accepted the first subsequent string | `export const path = './x'` could create a false dependency | Require import/re-export declaration structure |
| P1 | Graph edges called all AST observations syntax-confirmed, including the bounded structural fallback | Confidence exceeded the evidence | Record parser provenance and keep fallback/unknown graph edges inferred |
| P1 | `47f9438...` remains the only accepted Harness pin | Old activation evidence cannot establish current compatibility | Keep accepted pin; separately record the newly reviewed candidate |
| P2 | Harness analysis did not retain a directly queryable latest snapshot | The agent needed large reports or repeated analysis for questions | Add bounded session-owned search and impact queries |
| P2 | The scanner directly uses Node filesystem APIs | Local host assumptions do not compose with Harness remote filesystem providers | Introduce a read-only repository reader port before claiming remote support |
| P2 | Search selects at most 40 files; default action budget is 60; AST budget is 64 files | Large-repository results can be substantially partial | Expose coverage now; measure recall before increasing limits |
| P2 | Cached full-text evidence retains only 8,000 characters; cache identity uses metadata | Re-parsing or querying retained evidence is not complete fresh-file analysis | Label snapshots; next stage separates source material from display excerpts |
| P2 | Package has no runtime TypeScript dependency and the compiler API is optional | Packed consumers can use the structural fallback | Preserve fallback provenance; do not assume compiler-quality semantics |
| P2 | README calls the project private while GitHub reports a public repository | Repository visibility and npm publication policy are conflated | Resolved in `71e3231`: README distinguishes public repository from `private: true` package |

The fallback parser remains a limited structural observer. Its existing raw AST
status vocabulary is retained for compatibility; the new dependency graph explicitly
uses parser provenance to avoid upgrading fallback edges. Aliases, package exports,
dynamic imports, and runtime calls are not resolved in this increment.

## Current Harness source review

Fresh checkout: `reference/deepseek-harness/` (ignored, preserved locally).
Exact reviewed revision:
[`5badb15009ae1756c3afe0ae0cef1faafc290ccc`](https://github.com/deepseek-ai/deepseek-harness/commit/5badb15009ae1756c3afe0ae0cef1faafc290ccc).
The checkout reports `0.2.1-alpha.1`, Node `^22.19.0 || >=24.0.0`, and pnpm
`11.7.0`. This is a prerelease, not a stable compatibility guarantee. Audited file
hashes are in [the source review record](../reference/harness-upstream-review.json).

| Upstream surface | Source observation | RepoAtlas response |
|---|---|---|
| `packages/core/tools/src/index.ts` | Canonical output schema/render, execution signal, optional concurrency classifier | Keep native tools and JSON results; queries do not opt into parallel dispatch |
| `packages/core/session/src/types.ts` | Header retains optional cwd and exact session identity | Keep absolute cwd validation and WeakMap ownership; do not fall back to process cwd |
| `packages/interaction/user-approval/src/types.ts`, `packages/goal/goal/src/index.ts` | Approval outcomes and Goal service remain available | Preserve existing lifecycle authorizers; source inspection is not assignability proof |
| `packages/fs/fs/src/index.ts`, `packages/fs/README.md` | Execution-world filesystem seam and provider separation | Implemented reader port and Harness adapter; provider identity and containment regressions pass |
| `packages/lsp/README.md` | Four read-only navigation operations, externally configured language servers | Implemented opt-in navigation through configured `ctx.lsp`; live LSP acceptance remains open |
| `packages/session-query/`, `packages/workflow/` | Host has session retrieval and execution workflow capabilities | Focus RepoAtlas on repository evidence; avoid expanding a second workflow engine |

The [latest release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)
also describe changed subpath metadata handling and removal of invariant exports.
RepoAtlas does not import invariant exports or ship per-subpath package.json files.
These are review items, not evidence of a direct failure in this plugin. The
experimental Mods layer is not a reason to change RepoAtlas's native plugin surface.

Current compatibility status (2026-10-05): **official candidate declarations,
full upstream build, Loader, authenticated Web boot and native tool flow PASS** on
macOS. The candidate remains clean at the reviewed exact SHA, with disabled
installation scripts and the declared pnpm 11.7.0. The user's later authorization
allowed assessed deletion of task-owned synthetic directories/worktrees and
regenerable ignored build outputs. No upstream source was patched. Human LSP/UI,
label review, Windows and stable promotion remain open. The historical accepted
pin remains unchanged; candidate selection is explicit.

## External projects and choices

These are source/documentation comparisons, not benchmark results or dependencies.
No implementation code was copied and no new dependency was added.

| Project and reviewed revision | Useful approach | RepoAtlas decision |
|---|---|---|
| [Repomix](https://github.com/yamadashy/repomix/tree/8d6429121e98ed178e4d3a975c2bdbbecc958c4a) | Configurable repository packing, ignore rules, token budgets, compressed structure | Adopt bounded context selection and explicit coverage; defer packaging integrations |
| [Aider](https://github.com/Aider-AI/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c), [repo-map design](https://aider.chat/docs/repomap.html) | Task-relevant graph ranking within a context budget | Start with deterministic lexical ranking and reverse imports; introduce graph ranking only after recall measurements |
| [Serena](https://github.com/oraios/serena/tree/d0f7f92631c23dc4c5ed0b5ccd35bc623b19a809) | Symbol-oriented navigation through language servers | Compose with Harness LSP rather than embedding another server manager |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus/tree/5f9f95f22454b1f878ca549bc38b4c2ef5066b9a) | Relationship traversal and explicit impact queries | Adopt the user-facing impact question and evidence chains, without its storage stack or source code |

License observations from the repositories: GitNexus identifies PolyForm
Noncommercial 1.0.0; Serena's licensing overview separates SolidLSP (MIT) and the
application (GPL-3.0-or-later). These are additional reasons to keep this comparison
conceptual and review component terms before any future code reuse. Repository
popularity is not evidence of accuracy or suitability.

## Target architecture

Data flow: Harness session and policy -> bounded repository reader -> evidence
snapshot -> dependency graph and retrieval -> native tools and report projection.

- **Repository reader:** path, ignore, size, cancellation, and source identity.
  A local reader remains useful for offline tests; a Harness provider adapter is
  required for execution-world portability.
- **Evidence snapshot:** retained observations, parser provenance, snapshot identity,
  coverage, and eventually content fingerprints. Queries never imply live freshness.
- **Pure intelligence modules:** deterministic dependency resolution, lexical
  retrieval, reverse dependency traversal, later optional symbol evidence.
- **Harness adapter:** owns exact-session state and tool registration, not repository
  algorithms. Latest analysis replaces the query snapshot only after completion.
- **Legacy change lifecycle:** preserve public actions and tests. Freeze feature
  expansion. After the validation foundation is available, consider a separate
  mechanical extraction of the fixed Git adapter or stateless helpers, preserving
  public re-exports. Keep state-machine redesign in R5; do not split shared private
  state by lifecycle stage without characterization tests.

Do not add a vector database, persistent index, daemon, multi-agent scheduler, or
automatic patch generator to this iteration. Each introduces a separate operational
and evaluation problem before repository understanding is measured.

## Delivery stages

| Stage | Deliverable | Exit criteria | Current state |
|---|---|---|---|
| R1 | Extract graph construction; add `repo_atlas_search` and `repo_atlas_impact`; retain lifecycle | Resolution regressions, evidence-chain/cycle/budget tests, session isolation, cancellation, local compile/import | Delivered in `71e3231`; original verification retained |
| R2 | Non-deleting validation pipeline, labelled evaluation fixtures, current Harness compatibility, and repository-reader port | Artifact freshness/isolation checks; independently labelled corpus and baseline; official declarations at candidate SHA, provider parity, fail-closed behavior, Loader/Web smoke and manual queries | Artifacts/corpus delivered in `b107eea`; reader, candidate declarations, full build and native/Web verification pass; human/stable gates open |
| R3 | Evidence quality and incremental retrieval | Separate parse input from excerpts; content identity; ignore-rule contract; fresh/stale distinction; deterministic top-k fixtures | Implemented and locally verified; comparative synthetic baseline retained; human review pending |
| R4 | Optional symbol-level impact using Harness LSP | Definitions/references linked to precise locations, missing language server reported, no runtime breakage claims | Implemented opt-in; provider regressions pass; live LSP/UI acceptance pending |
| R5 | Legacy module separation and product polish | Public lifecycle behavior unchanged, reader/graph/adapter boundaries testable, bilingual usage, clean packed consumer validation | Physical adapter/helper extraction implemented; full suite including real Git adapter cases passes; Windows acceptance open |

R2 must not silently turn direct local reads into remote access. Define provider
identity, workspace mapping, cancellation, and partial reads before implementing
that port. Do not promote a candidate pin until declaration, activation, and manual
query gates pass. The default target for **formal supported-pin promotion** is a
stable 0.2.x release; a later stable release requires a new compatibility review.
Continue adapting and experimentally testing the exact alpha revision now, with
its results in a separate candidate record. A stable version label never replaces
testing, and experimental alpha passes never silently replace the accepted manifest.
An exception to stable-only formal promotion requires a separate explicit support
policy decision. New dependencies remain a separate explicit decision.

Labelled evaluation fixtures move forward into R2, alongside validation-tooling
work; R3 consumes the recorded baseline rather than creating its first corpus.
Fixtures should cover TS/JS applications, monorepos with aliases,
re-exports/cycles, partial/sensitive repositories, and unsupported languages. Track
edge precision, labelled relevant-file recall at k=10, evidence citation validity,
unknown/partial detection, output size, bytes read, and elapsed time. Proposed exit
targets: all fixture citations resolve within the snapshot, zero false resolved
edges in the labelled resolver fixtures, and no cross-session evidence access.
The synthetic baseline below measures current recall; it establishes neither a
speedup nor a real-repository benchmark. Synthetic monorepo and application coverage was added on October 7; real-repository
coverage remains future work.

## Review decisions and revised R2 order (2026-10-04)

The external review is advisory. This section records planning decisions; the
subsequent R2a/R2b delivery is recorded separately below. Lifecycle extraction has
not been implemented. Remote HEAD and the latest release were rechecked and
still identify `5badb150...` / `dsh-v0.2.1-alpha.1`.

### R2a: Non-deleting artifact validation

Accept this as the next implementation priority. Compile into a unique task-owned
output directory and construct a package staging directory whose internal exports
still resolve to `dist/`. Pack only that fresh staging tree; do not combine it with
old workspace `dist` files. Preserve artifacts on success and failure and return
their exact paths. Review subprocesses and lifecycle hooks as well as direct `rm`
calls. A temporary-directory name alone does not make a deleting operation allowed.

Required tests: unrelated files survive; stale outputs from an earlier source tree
cannot enter the new artifact; failed builds cannot be reported or packed as fresh;
root and Harness imports work in a fresh offline consumer; repeated runs use
independent output paths. Check fresh directory creation, symlink handling, and
platform-specific paths. Keep normal package exports and npm prepack behavior
explicit; changing only the compiler output path would break consumers.

There are separate blockers:

- **Artifact cleanup:** our build/verify helpers can be redesigned to retain outputs.
- **Semantic deletion tests:** `test/analysis.test.ts` deletes a source file to test
  invalidation; a real Git adapter test verifies worktree removal. Retaining temporary
  directories does not eliminate these actions. Preserve those cases and report them
  unexecuted while the restriction applies; do not replace them with no-op mocks and
  call the full suite passed.
- **Upstream build:** `scripts/build.ts` deletes a client build record, and downstream
  scripts need their own audit. A patched upstream tree cannot count as a clean
  exact-revision acceptance run. Seek a supported non-deleting build path or document
  the remaining blocker; do not silently patch the reviewed checkout.
- **OpenSpec:** its CLI is missing. This is an independent tooling prerequisite,
  not a deletion problem. Resolve the pinned CLI availability separately under the
  existing dependency-installation rules.

### R2b: Labelled fixtures and evaluation baseline

Accept fixture preparation before R3. Existing regression fixtures are useful but
are not an independently labelled retrieval evaluation corpus. Each new case needs
a small synthetic repository, query/changed targets, manually reviewed relevant
files and dependency edges, explicitly unresolved cases, and expected coverage.
Keep labels outside scanned repository contents so answers cannot leak into the
retrieval input. Label version and provenance must be recorded; expected answers
must not be generated by the algorithm under evaluation.

Measure the existing 40-file search, 60-action and 64-AST-file defaults before any
budget change. Include fixtures that exceed those limits and retained-text limits,
plus aliases, re-exports, cycles, unsupported languages, and synthetic sensitive
paths. Record precision/recall, citation validity, unknown detection, output size,
I/O and timing; distinguish hand-labelled correctness cases from scale benchmarks.
R2a and R2b may advance independently; neither needs to wait for stable upstream.

### R2c: Compatibility and optional narrow extraction

Run exact-candidate declarations and activation after their build prerequisites
are met. Preserve alpha experimental status until the formal promotion rule is
satisfied. Independent evidence-quality work need not wait for a stable release.

Partially accept earlier lifecycle extraction: a separate, behavior-preserving
increment may move the fixed Git adapter or stateless helpers after relevant
characterization checks are available. Keep existing import paths through re-exports,
fixed argv, digests, approval ordering, uncertain outcomes and ownership intact.
Review safety lint at the same time: its current privileged Git-adapter exception
is tied to `src/repository/change-proposal.ts`. File movement is not automatically
low risk, and the exception must not broaden to arbitrary files. Where real Git
coverage remains blocked, do not claim full behavioral equivalence. Do not move the
whole state machine ahead of repository-intelligence work merely to reduce lines.

### R3/R4 watch list: Dynamic tool availability

The upstream [dynamic-tool design note](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.agents/notes/implemented/architecture/2026-09-20-dynamic-tool-updates.md)
and `packages/core/session/README.md` confirm capability-dependent tool-update
projection. Modes include `addition-only` and `in-history`; unsupported routes use
active definitions. Same-name schema changes, new request series, and surface
replacement can invalidate prefix reuse. Provider cache availability/eviction is
not guaranteed by tool registration.

Keep `search` and `impact` statically registered with fail-closed prerequisites for
now. Before changing visibility, verify per-session scoping (not global registration
after one session completes analysis), fork/resume behavior when in-memory analysis
is absent, capability fallback, schema stability, and plugin disposal. Compare
schema/context overhead and measured cache behavior against the static baseline;
only adopt dynamic availability when the benefit justifies the additional lifecycle.

Additional projects named in the review (ast-grep, tree-sitter, gitingest,
code2prompt) remain **unreviewed suggestions** for future language/packing work.
They are not selected dependencies or sources for current compatibility claims.

## R2a/R2b implementation and measured baseline (2026-10-04)

This local increment implements the validation pipeline and initial synthetic
corpus. It does not complete R2c, provider portability, formal support promotion,
or manual Harness acceptance. No dependency, runtime budget, pin or lifecycle
permission changed. The clean upstream checkout and remote HEAD still agree at
`5badb15009ae1756c3afe0ae0cef1faafc290ccc`.

Builds allocate `.codex/artifacts/build-*/package/dist` and retain result records.
Normal build preserves public root dist exports after a stale-file/symlink check;
`--isolated` leaves root dist alone. Artifact smoke packs a fresh staging package,
disables source lifecycle hooks and installs into a new offline consumer. Root
projection is not atomic on I/O failure, which is reported as failed. Build logs
use stderr so standard `npm pack --json` remains parseable. API/compatibility
helper scratch directories are also retained; their current-upstream execution is
not implied by this cleanup change.

Labels are external to scanned roots and independent of algorithm outputs, with
`agent-authored-synthetic-ground-truth` / `human-review-pending` provenance. The
[baseline report](../evaluation/baselines/r1-defaults-2026-10-04.json) records source,
input, evaluator and label hashes, parser provenance, budgets and metric definitions.
Run it with `npm run evaluate:repository`; all reports remain in ignored
`.codex/evaluation/run-*` directories.

| Synthetic case | Edge recall | Retrieval recall | Impact recall | Observation |
|---|---|---|---|---|
| Cycle/re-export/test dependent | 4/4 | 4/4 | 3/3 | Full labelled coverage in this small case |
| Unresolved aliases/missing target | N/A | 2/2 | N/A | No false resolved edge; dynamic imports remain outside scope |
| Unsupported Python graph | N/A | 2/2 | N/A | Text retrieval works; labelled Python relation remains unsupported |
| 72-file chain | 15/71 | 0/1 | 0/71 | Analysis exhausts its default budget before the tail target |
| Retained-text boundary | N/A | 0/1 | N/A | Query marker beyond 8,000 retained characters is absent from search |
| Synthetic sensitive content | N/A | 1/1 | N/A | Placeholder is redacted; sensitive path not used as evidence |

Retrieval uses unique paths from the top ten evidence records, not ten distinct
file results. Impact uses default depth 3 / limit 50 against the full labelled
set. Empty denominators are null. All observed graph edges match the labels;
snapshot references, redaction and expected budget statuses pass. This is a single
macOS synthetic run; citation checks do not validate fresh line content, and timing
does not establish stable latency or real-project performance. Keep low-recall
results visible for R3 rather than raising budgets or rewriting labels to fit them.

The selected suite passes 90 cases, including four new real-compiler artifact
tests. Typecheck, existing lint, normal build/prepack and fresh offline imports
pass. The eight deletion-bearing cases, missing OpenSpec CLI, current-Harness
official build/declarations/Loader/Web, manual interaction and Windows execution
remain separate uncompleted gates. Exact commands and retained paths are in the
new [OpenSpec tasks](../openspec/changes/non-deleting-validation-and-evaluation/tasks.md).

## R1 usage and verification

1. Call `repo_atlas_analyze` with a confirmed goal or `start: "direct"`.
2. Call `repo_atlas_search` with `{ "query": "server", "limit": 10 }`.
3. Call `repo_atlas_impact` with
   `{ "targets": ["src/server.ts"], "maxDepth": 3, "limit": 50 }`.

Queries use the latest analysis in the exact calling session, perform no additional
filesystem or Git work, and return `snapshot-not-revalidated`. Rerun analysis after
editing source. Impact is file-level potential impact; inspect its evidence before
choosing edits or tests. Unsupported/unobserved paths remain unknown.

Historical R1 verification commands and outcomes are recorded in the active OpenSpec
[tasks](../openspec/changes/repository-intelligence-foundation/tasks.md). Full legacy
cleanup tests, official current-Harness compilation, live activation, and Windows
execution remain distinct gates. R2a unlocked packed artifacts; the October 5
follow-up closes the full suite, full upstream build and automated native/Web gates.
Windows and manual gates remain open. R1 completion does
not claim completion of R2–R5 or a new supported Harness release.

## R2c/R3/R4 and mechanical R5 implementation (2026-10-04)

The reader now separates host lexical policy from backend canonical targets. Auto
mode uses configured Harness fs, with no silent fallback after selection. Local
Node reads remain explicit/offline. The exact older accepted source has `lstat`
and bounded reads but lacks `processPathFromHostPath`; that capability is optional
for reads and required for host Git/checks. An explicit local reader is available
for an intentionally local workflow. Provider errors are sanitized before reporting.

Root positive ignore rules are bounded to 16 KiB, 128 rules and 256 characters
per rule. Policy reads consume existing byte/action budgets even when source scope
is narrower. Sensitive paths and configured exclusions remain independent.
Unsupported and nested policy coverage is explicit; matching uses memoized glob
states instead of regex backtracking. Directory visits and listing processing are
capped. Single-file scopes are supported without listing unrelated siblings.

Source material carries redacted-content identity and an evidence reference,
retained separately from display excerpts. Each retained representation is bounded
by `maxTotalBytes`; display/AST metadata has its existing separate bounds. Metadata
reuse is labelled; content mode rereads within unchanged budgets. Prior cache data
is cloned before replacement. Deterministic lexical ranking returns distinct files
before repeated observations. No graph ranking or budget increase is justified by
the current six synthetic cases; the 72-file chain remains deliberately partial.

Optional symbols use only configured Harness LSP. The query source is reread and
checked against its retained redacted snapshot; redaction that changes cursor
coordinates blocks navigation. Locations use the provider's canonical workspace
URI and one-based UTF-16 half-open ranges. Processing is limited to 1,000 returned
locations, configured output to 1–100, timeout to at most 15 seconds, hover input
to 64 KiB and output to 8 KiB. External/sensitive/unobserved targets are filtered.
Target content is not freshly validated and references do not prove runtime impact.

The lifecycle manager is now 1,448 lines (baseline 2,056), with a 246-line fixed
Git adapter, 369-line stateless helper module and 39-line error module. State and
event ownership remain in the manager. Public adapter re-export, digests, approval
order, fixed argv and uncertain outcomes are preserved. The sole equivalent parser
edit changes RegExp.exec to String.match for the same nonglobal expression, keeping
the lightweight process lint exception confined to the actual adapter.

See the current [integration verification record](../openspec/changes/repository-intelligence-integration/tasks.md)
and [R3 comparative baseline](../evaluation/baselines/r3-source-snapshots-2026-10-04.json).
Implementation and local regression results do not close human label review,
real-provider LSP/UI, Windows or stable promotion gates; full upstream build and
automated native/Web verification were subsequently completed on October 5.

Cordis returns a new traced service wrapper for each lookup. Reader identity uses
its exported `cordis.original` symbol solely to bind the underlying service; all I/O
continues through the traced wrapper. The exact candidate's official emitted
Cordis/Cosmokit component probe passes distinct-wrapper identity, actual service
replacement and caller-context preservation. This narrow component probe is part
of candidate API verification and is not a packaged Loader/Web acceptance run.

Read budgets conservatively charge bounded attempts even when a backend fails after
reading. Missing stable version/time metadata blocks content reads. This prevents
failed reads from escaping the total-byte gate. Session cwd validation retains the
existing host-platform absolute-path requirement; opposite-platform cwd encodings
and Windows execution have no new acceptance claim.

## Native runtime follow-up (2026-10-05)

The user's assessed-deletion exception closes the eight legacy test exclusions:
129 unfiltered cases now pass. The exact official build includes the native addon,
host/client declarations, bundler and Web frontend. Verification uses the installed
pinned package manager and built public CLI, avoiding the global pnpm wrapper's
runtime dependency recheck. Authenticated loopback startup follows the browser
cookie bootstrap; credentials are never persisted in the validation record.

A real Agent/native ToolRuntime probe exposed optional `undefined` analysis fields
that the current lossless-JSON registry rejects. The output-only projection now
omits absent object fields, preserves valid values and rejects lossy/executable
values without changing authorization. All eight native checks pass after that fix.
The [final synthetic baseline](../evaluation/baselines/runtime-json-output-2026-10-05.json)
retains the R3 recall measurements and unchanged independent labels/budgets. See
[delivery evidence](../openspec/changes/repository-intelligence-integration/tasks.md)
and [candidate validation](../reference/harness-candidate-validation.json) for gates.
Real configured LSP, human UI/label review, Windows and stable support remain open.


## Application and monorepo evaluation follow-up (2026-10-07)

The next bounded R2b/R3 increment adds two synthetic cases under the existing
evaluation framework: a mixed TS/JS routing/service/utility application and a
two-application workspace with direct imports, shared re-exports, a configured
alias and a package name. Inputs and labels were authored before execution; labels
stay outside scan roots with human review pending. Runtime code, dependencies,
numeric budgets and plugin authority remain unchanged.

Small complete cases now enforce labelled graph/retrieval/impact coverage,
unresolved-import equality and exact unknown targets. All cases check graph
references and reject explicitly unsupported resolved relations. Sensitivity
regressions prove missed observations and unsafe references fail these gates;
the intentionally partial chain case keeps its measured deficits.

The eight-case baseline records application edges 5/5, retrieval 3/3 for each
query and impact 4/4; monorepo edges 6/6, retrieval 6/6 and 2/2, impact 5/5,
two unresolved imports and the exact absent target. Original six-case graph,
query, impact, budget and read-charge metrics, configuration and runtime source
hash remain identical to the October 5 baseline. The 72-file chain remains 15/71
edges, tail retrieval 0/1 and impact 0/71 with budget exhaustion.

Local verification passes 131 unfiltered tests, typecheck, safety lint, fresh
build/pack/offline imports and strict OpenSpec (36 items). CI now evaluates the
corpus in the existing Node 22/24 matrix and triggers on the current refactor
branch's push as well as main/PR. Remote run status is a separate delivery check.
See the [OpenSpec verification record](../openspec/changes/application-monorepo-evaluation/tasks.md)
and [eight-case baseline](../evaluation/baselines/application-monorepo-2026-10-07.json).
No private logs or generated package are published with this increment.

Human label review, real-repository evaluation, configured LSP/UI acceptance,
Windows execution and stable Harness support remain open. Synthetic passes do
not close those gates; no active change is archived or compatibility pin promoted.


## Independent review repairs and delivery contract (2026-10-07)

Full review of the six-commit main-to-candidate change reproduced two P2 defects
that blocked delivery: scanner I/O caps exceeded the precharged metadata sizes,
and formatted AST module values could select a different observed file. Both are
repaired in a separate increment after the frozen evaluation candidate.

Content and root-ignore reads now pass precisely the reserved metadata size as
their cap. Growth is rejected before I/O, and failure/cancellation after I/O retains
the complete charge. Zero-length and exact-budget reads remain valid. Module
observations retain exact semantic text only within the existing 160 UTF-16
code-unit bound; summary formatting stays separate. The optional
`moduleSpecifierExact` flag must be true before resolution. Oversized, redacted,
legacy unmarked and unreliable structural literals remain unresolved with
`unverified-module-specifier`. Compiler values use decoded TypeScript text;
fallback escapes are not partially decoded. Cache schema 4 invalidates schema-3
AST evidence and reparses it within unchanged budgets.

The unfiltered suite passes 139 cases. The isolated fallback probe passes 11
checks; the same probe with the already installed official TypeScript 6.0.3 API
passes 9 checks and asserts actual parser/version. This repository's TypeScript
7.0.2 supplies the native compiler CLI but lacks the JavaScript compiler API, so
ordinary Node CI validates fallback rather than claiming compiler-path coverage.
No dependency was added. Continuous real-compiler CI can later compose the probe
with the existing manual Harness environment; it remains distinct from default CI.

Fresh build/pack/offline imports, typecheck, safety lint and strict OpenSpec (37
items) pass. The clean exact alpha Harness at `5badb150...` reruns official
declarations/Cordis, Loader, authenticated Web and 8 native tool-flow checks using
its existing official build. No upstream source or dependency tree is changed.
The [repair baseline](../evaluation/baselines/budget-module-identity-2026-10-07.json)
records the changed runtime source hash; all eight cases preserve their previous
graph/query/impact, budget/read-charge and reference metrics and independent labels.
The [repair verification record](../openspec/changes/bounded-read-and-module-identity-repair/tasks.md)
contains exact commands and retained evidence.

The authorized integration endpoint is the current repository-intelligence
implementation merged normally into main after full-scope independent review,
accurate sensitive-content checks and exact Node 22/24 remote CI. Six earlier
commits plus this repair must be reviewed as the whole PR; a small batch review
alone is insufficient. Main and the branch are checked by exact remote SHA.
No force push, branch-protection bypass, release or deployment is part of that
endpoint. Git/PR/Actions state remains authoritative for remote delivery.

Human label review requires an actual person reviewing source and labels. Real
LSP/UI requires the configured language server and observed user flow; Windows
requires a real Windows environment. Stable support promotion requires a real
stable upstream revision plus its complete compatibility acceptance. These gates,
real-repository evaluation and measured large-repository recall remain pending;
merge permission does not manufacture their evidence or archive unfinished changes.
