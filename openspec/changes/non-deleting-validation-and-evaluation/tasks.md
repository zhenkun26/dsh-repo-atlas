## 1. Fresh non-deleting artifacts

- [x] 1.1 Add a shared build helper with isolated package trees and retained pass/fail records.
- [x] 1.2 Preserve normal dist exports while rejecting stale files and symlink targets before projection.
- [x] 1.3 Pack only fresh isolated outputs and validate a new offline consumer with source hooks disabled.
- [x] 1.4 Retain API/compatibility helper scratch directories without changing pins or approvals.
- [x] 1.5 Add real-compiler regressions for independent builds, preservation, failure, projection and symlinks.

## 2. Labelled evaluation foundation

- [x] 2.1 Author corpus roots and external labels with provenance and pending human review.
- [x] 2.2 Add cycle, unresolved, unsupported-language and synthetic-sensitive cases.
- [x] 2.3 Materialize 72-file and retained-text stress cases without deleting outputs.
- [x] 2.4 Record reproducible default-budget metrics and a persisted baseline.

## 3. Validation and delivery

- [x] 3.1 Record final selected suite, typecheck, lint, normal build/prepack and offline artifact smoke.
- [x] 3.2 Run OpenSpec CLI validation when the pinned CLI is available (1.7.0 follow-up below).
- [x] 3.3 Run current-Harness official declarations, full build and Loader/Web/native tool smoke (2026-10-05 follow-up).
- [ ] 3.4 Complete manual query/LSP/UI acceptance separately from automated runtime checks.

No acceptance-pin promotion, upstream patch, dependency addition, runtime budget
change, or lifecycle extraction is included. Eight deletion-bearing legacy cases
remain unexecuted under the active restriction. This change remains active until
its outstanding validation is resolved; the original R1 historical record stays intact.

## Historical verification record (2026-10-04)

Environment: macOS, Node 24.20.0. No dependencies were added or installed in this
increment; package exports, accepted Harness pin and runtime budgets are unchanged.

| Check | Outcome | Evidence / limitation |
|---|---|---|
| Selected local suite | PASS | 90 executed cases, including four new real-compiler regressions; eight deletion-bearing legacy cases excluded |
| `npm run typecheck` | PASS | Full src/test/scripts TypeScript check |
| `npm run lint` | PASS | Existing lightweight safety lint scanned 29 source files; not comprehensive script/security coverage |
| Normal build and prepack | PASS | Real `npm pack --json` ran the source prepack hook; output parsed, 121 entries, no evaluation corpus in package |
| `npm run build -- --isolated` | PASS | CLI returns a fresh retained package without root dist projection |
| `npm run verify:built-artifact` | PASS | Fresh isolated tarball; new offline consumer with scripts disabled; plain Node root/Harness imports and all four default tools registered |
| `npm run evaluate:repository` | PASS (integrity gates) | Six cases; zero false resolved edges; snapshot references, redaction, sensitive-path exclusion and expected budget status pass; low recall remains in the report |
| Persisted baseline hashes | PASS | Source/input hashes recorded; label/evaluator hashes checked against final files |
| Fresh upstream check | PASS (source only) | Fetch completed; clean source and remote HEAD still at `5badb15009ae1756c3afe0ae0cef1faafc290ccc` |
| `git diff --check` | PASS | Code and documentation whitespace check |
| OpenSpec CLI validation | BLOCKED | `openspec` not on PATH; no undeclared CLI installed |
| Full unfiltered suite | BLOCKED | Eight legacy cases perform source deletion/worktree removal or temporary cleanup prohibited by the active user instruction |
| Current Harness official build/declarations/Loader/Web | BLOCKED | Exact upstream build includes prohibited deletion; helper retention does not remove this prerequisite |
| Manual Harness query acceptance | NOT RUN | No live UI acceptance claim |
| Windows execution | NOT RUN | Symlink test requires separate Windows privilege/behavior acceptance |
| Push / release | NOT PERFORMED | New increment stays local pending authorization; no merge, publication, tag or release |

Selected suite command (unchanged exclusions):

```sh
node --test --experimental-strip-types \
  --test-skip-pattern='changed and deleted paths|report export requires|scanner parse-ast honors|patch verification runner|node Git adapter' \
  test/*.test.ts
```

The eight cases and their reason remain listed in the historical R1 record. The
Node selected runner reports zero skipped cases because pattern-excluded cases
are not counted; this is not an unfiltered-suite pass. Legacy tests were preserved.

Standard prepack was also invoked with `npm pack --json --pack-destination` pointing
to a fresh `.codex/artifacts/prepack-*` directory; the captured stdout was parsed
as JSON. Build diagnostics go to stderr. All tarballs and scratch directories
were retained.

Final retained evidence (relative to the checkout):

- Offline smoke package, tarball, consumer and cache: `.codex/artifacts/build-ocoyIB/`.
- Normal build result: `.codex/artifacts/build-8WErKf/result.json`.
- Standard prepack tarball: `.codex/artifacts/prepack-MW7Q5Z/dsh-repo-atlas-0.1.1.tgz`.
- Raw evaluation report: `.codex/evaluation/run-BJFz1o/report.json`.
- Versioned baseline: `evaluation/baselines/r1-defaults-2026-10-04.json`.

Measured limitations: the small cycle case has full labelled graph/retrieval/impact
recall. The 72-file chain has edge recall 15/71, tail retrieval 0/1 and impact 0/71,
with budget exhaustion correctly reported. Retained-text retrieval is 0/1 beyond
the 8,000-character excerpt. These synthetic agent-authored labels remain pending
human review; timings and snapshot references do not prove real-repository speed,
recall, live freshness or current Harness compatibility.

R2a/R2b implementation is complete as a local increment. The broader R2 remains
open for label review, provider/reader work and candidate acceptance. Do not archive
this change or promote the supported pin while the outstanding gates remain open.

## Validation follow-up (2026-10-04)

The user approved installing the documented OpenSpec CLI 1.7.0 in an isolated
task directory with installation scripts disabled. Strict all-item validation now
passes: 35 items including the current integration change, with telemetry disabled.
This closes the CLI prerequisite without rewriting the earlier blocked record.

The current integration independently passes official candidate declarations and
provider/source/LSP regressions; see [its record](../repository-intelligence-integration/tasks.md).
Historical pins and original measurements are preserved. Full deletion-bearing
suite and upstream runtime acceptance remain open; no active change is archived.

Delivery clarification: R2a/R2b were subsequently committed and pushed as
`b107eea` under user authorization. The earlier NOT PERFORMED row describes the
pre-authorization verification point; it is not the current branch-delivery state.

## Runtime validation follow-up (2026-10-05)

After the user authorized assessed, harmless deletion, the preserved unfiltered
suite passes all 129 tests, including the eight previously excluded cases. The
clean exact candidate passes its full official build, declarations, Loader,
authenticated Web startup and eight checks through real Agents and the native tool
registry. The latter uncovered and now verifies the lossless-JSON DTO fix. Earlier
blocked rows remain historical; see the [current integration record](../repository-intelligence-integration/tasks.md).
Human label/LSP/UI review, Windows execution and stable formal-support promotion
remain separate open gates. No active change is archived.
