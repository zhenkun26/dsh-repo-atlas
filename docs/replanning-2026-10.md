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

Specific findings from the source review:

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
| P2 | README calls the project private while GitHub reports a public repository | Repository visibility and npm publication policy are conflated | Clarify public repository versus `private: true` package |

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
| `packages/fs/fs/src/index.ts`, `packages/fs/README.md` | Execution-world filesystem seam and provider separation | Plan reader adapter; current scanner remains local-only |
| `packages/lsp/README.md` | Four read-only navigation operations, externally configured language servers | Later enrich evidence through optional `ctx.lsp`; no new language-server daemon now |
| `packages/session-query/`, `packages/workflow/` | Host has session retrieval and execution workflow capabilities | Focus RepoAtlas on repository evidence; avoid expanding a second workflow engine |

The [latest release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)
also describe changed subpath metadata handling and removal of invariant exports.
RepoAtlas does not import invariant exports or ship per-subpath package.json files.
These are review items, not evidence of a direct failure in this plugin. The
experimental Mods layer is not a reason to change RepoAtlas's native plugin surface.

Current compatibility status: source-reviewed only. Official declaration compilation,
Loader activation, Web boot, and manual interaction against this revision have not
run. The upstream root build calls `rmSync` in `scripts/build.ts`, and current
RepoAtlas build/smoke helpers also delete outputs or temporary directories. The
active no-filesystem-deletion instruction prevents those paths in this session.
Do not replace the accepted pin or relabel its historical smoke as a new pass.

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
  expansion; later separate its state machine from the fixed Git adapter without
  altering authorization or recovery behavior.

Do not add a vector database, persistent index, daemon, multi-agent scheduler, or
automatic patch generator to this iteration. Each introduces a separate operational
and evaluation problem before repository understanding is measured.

## Delivery stages

| Stage | Deliverable | Exit criteria | Current state |
|---|---|---|---|
| R1 | Extract graph construction; add `repo_atlas_search` and `repo_atlas_impact`; retain lifecycle | Resolution regressions, evidence-chain/cycle/budget tests, session isolation, cancellation, local compile/import | Implemented locally; see verification below |
| R2 | Current Harness compatibility and repository-reader port | Official declarations at candidate SHA, local-provider fixture parity, missing-provider fail-closed, Loader/Web smoke and manual queries | Pending; source review completed |
| R3 | Evidence quality and incremental retrieval | Separate parse input from excerpts; content identity; ignore-rule contract; fresh/stale distinction; deterministic top-k fixtures | Planned |
| R4 | Optional symbol-level impact using Harness LSP | Definitions/references linked to precise locations, missing language server reported, no runtime breakage claims | Planned |
| R5 | Legacy module separation and product polish | Public lifecycle behavior unchanged, reader/graph/adapter boundaries testable, bilingual usage, clean packed consumer validation | Planned |

R2 must not silently turn direct local reads into remote access. Define provider
identity, workspace mapping, cancellation, and partial reads before implementing
that port. Do not promote a candidate pin until both declaration and activation
gates pass. New dependencies remain a separate explicit decision.

Evaluation fixtures should cover TS/JS applications, monorepos with aliases,
re-exports/cycles, partial/sensitive repositories, and unsupported languages. Track
edge precision, labelled relevant-file recall at k=10, evidence citation validity,
unknown/partial detection, output size, bytes read, and elapsed time. Proposed exit
targets: all fixture citations resolve within the snapshot, zero false resolved
edges in the labelled resolver fixtures, and no cross-session evidence access.
No speedup, recall score, or large-repository benchmark is claimed yet.

## R1 usage and verification

1. Call `repo_atlas_analyze` with a confirmed goal or `start: "direct"`.
2. Call `repo_atlas_search` with `{ "query": "server", "limit": 10 }`.
3. Call `repo_atlas_impact` with
   `{ "targets": ["src/server.ts"], "maxDepth": 3, "limit": 50 }`.

Queries use the latest analysis in the exact calling session, perform no additional
filesystem or Git work, and return `snapshot-not-revalidated`. Rerun analysis after
editing source. Impact is file-level potential impact; inspect its evidence before
choosing edits or tests. Unsupported/unobserved paths remain unknown.

Verification commands and final outcomes are recorded in the active OpenSpec
[tasks](../openspec/changes/repository-intelligence-foundation/tasks.md). Full legacy
cleanup tests, packed-artifact validation, official current-Harness compilation,
live activation, and Windows execution remain distinct gates. R1 completion does
not claim completion of R2–R5 or a new supported Harness release.
