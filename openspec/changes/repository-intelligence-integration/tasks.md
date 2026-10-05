## 1. Reader adaptation

- [x] 1.1 Introduce local and Harness read-only readers with containment and byte caps.
- [x] 1.2 Integrate analysis, provider-bound cache compatibility and host-Git guards.
- [x] 1.3 Verify provider parity, cancellation, symlink and malformed-listing behavior.

## 2. Evidence quality

- [x] 2.1 Separate bounded redacted source material from display excerpts.
- [x] 2.2 Record content identity, reuse freshness and incomplete coverage.
- [x] 2.3 Evaluate deterministic retrieval and preserve comparative metrics.

## 3. Optional symbols

- [x] 3.1 Add bounded session-owned LSP navigation using the configured service.
- [x] 3.2 Verify precise locations, missing providers, cancellation and external results.
- [ ] 3.3 Accept the real configured LSP and human UI flow separately from service mocks.

## 4. Lifecycle boundaries

- [x] 4.1 Extract fixed Git adapter and stateless helpers with public re-exports.
- [x] 4.2 Keep safety lint scoped to the actual privileged adapter.
- [x] 4.3 Run deletion-free lifecycle characterization with unchanged approval/digest tests.
- [x] 4.4 Run the preserved real adapter and deletion-bearing cases after the assessed task-directory exception.

## 5. Verification and delivery

- [x] 5.1 Compile the clean exact-candidate official declarations and run the official Cordis component probe.
- [x] 5.2 Validate OpenSpec, TypeScript, lint, the selected suite and fresh package exports.
- [x] 5.3 Update bilingual usage, roadmap, result records and candidate limitations.
- [x] 5.4 Review the increment and prepare commit/push on the existing authorized task branch.
- [x] 5.5 Complete exact-candidate full build, Loader/Web and native tool-flow verification.
- [x] 5.6 Complete the unfiltered suite, including real Git adapter cases.
- [ ] 5.7 Complete human label review, real configured LSP/UI and separate Windows acceptance.

Human label/UI acceptance, stable formal-support promotion and Windows execution
are separate evidence gates. The user subsequently authorized deletion only after
assessing lack of impact. The exception was limited to task-owned synthetic test
directories/worktrees and regenerable ignored upstream outputs; retained delivery
artifacts and unrelated files are preserved.

## Historical verification record (2026-10-04)

Environment: macOS, Node 24.20.0; RepoAtlas TypeScript 7.0.2, upstream TypeScript
6.0.3. The upstream was fetched again with tags and remains clean at
`5badb15009ae1756c3afe0ae0cef1faafc290ccc` (`0.2.1-alpha.1`). Its existing pinned
dependencies were installed with lifecycle scripts disabled. The user separately
approved isolated OpenSpec CLI 1.7.0 installation. No RepoAtlas dependency or
lockfile was added or changed.

| Check | Outcome | Evidence / limitation |
|---|---|---|
| Selected local suite | PASS | 117 cases; eight preserved deletion-bearing cases excluded; this is not a full-suite pass |
| TypeScript / safety lint / diff | PASS | Full project typecheck, 36 source files scanned, whitespace check; lightweight lint is not a comprehensive security audit |
| OpenSpec 1.7.0 strict all-item validation | PASS | 35 items, 0 failures, telemetry disabled |
| Standard source prepack | PASS | Fresh retained tarball, 149 package entries, root/Harness/symbol exports present; evaluation/reference/source excluded |
| Fresh packed consumer | PASS | Independent isolated build, tarball and offline install with scripts disabled; plain Node imports, four default tools, symbols absent by default and present when enabled |
| Six-case evaluation | PASS (integrity gates) | Independent unchanged labels; no false resolved edges; snapshot-reference integrity, full-material redaction, sensitive-path exclusion and expected budget status pass |
| Final source/evaluator/label hashes | PASS | Match the persisted comparative baseline and retained raw report |
| Official upstream host TypeScript project | PASS | `node --max-old-space-size=4096 node_modules/typescript/bin/tsc -b tsconfig.host.json`; clean exact candidate; not the full native/bundler build |
| Candidate API declarations | PASS | Official fs/LSP and existing tools/context/approval/goals/sandbox/subprocess assignability |
| Official Cordis component | PASS | Actual emitted Cordis/Cosmokit: distinct traced wrappers share reader identity, replacement invalidates identity, I/O retains consumer context; not packaged Loader/Web activation |
| Accepted-pin mismatch guard | PASS | Default verifier rejects the candidate checkout instead of silently changing the historical accepted target |
| Workflow configuration | PASS (syntax only) | Manual accepted/candidate selector uses exact manifests; workflow not dispatched |
| Full unfiltered suite | BLOCKED | Eight cases include filesystem deletion/worktree removal or cleanup forbidden by the user-provided AGENTS.md |
| Full upstream build / Loader / Web boot | BLOCKED | Upstream native/bundler wrappers delete generated files or temporary directories; no exception granted and no upstream source patched |
| Real LSP / human UI flow | NOT RUN | Synthetic service tests and official declarations cannot establish live semantic navigation or UI acceptance |
| Human corpus review / Windows | NOT RUN | Agent-authored synthetic labels remain human-review-pending; macOS checks do not prove Windows support |
| Formal 0.2.x support promotion | NOT APPLICABLE | Candidate is prerelease; requires stable release and every acceptance gate; historical accepted pin unchanged |
| Branch delivery | READY | Reviewed increment prepared for authorized commit/push on `refactor/repository-intelligence`; Git history and remote head are the delivery authority |
| Merge / deployment / release | NOT PERFORMED | No integration merge, tag, deployment or release is included |

Selected suite command (same eight exclusions as R1/R2a):

```sh
node --test --experimental-strip-types \
  --test-skip-pattern='changed and deleted paths|report export requires|scanner parse-ast honors|patch verification runner|node Git adapter' \
  test/*.test.ts
```

Node reports zero skipped cases because pattern-excluded cases are not counted.
The eight cases remain intact: source-deletion and report-export tests, scanner AST
cleanup, two verification-runner cleanup tests, and three actual Git adapter tests.
The export fixture now uses a fresh task-owned destination; its deletion-bearing
cleanup still was not executed. No deletion restriction was bypassed.

Candidate command (requires fresh built RepoAtlas declarations):

```sh
REPO_ATLAS_HARNESS_ROOT=/absolute/path/to/deepseek-harness \
  npm run verify:harness-api-contract -- --candidate
```

OpenSpec command (isolated approved tool):

```sh
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 \
  .codex/tools/openspec-bUpUzW/node_modules/.bin/openspec \
  validate --all --strict --no-interactive
```

Retained final evidence, relative to this checkout unless noted:

- Selected suite: `.codex/selected-integration-final-reviewed.log`.
- Fresh offline build/consumer/tarball: `.codex/artifacts/build-1DcmhK/`.
- Standard prepack: `.codex/artifacts/prepack-reviewed-H86w1n/pack-result.json`
  and `dsh-repo-atlas-0.1.1.tgz` in that directory.
- Official candidate contract probe: `/var/folders/0l/4wxf7k013_s34b2wkdljpq1r0000gn/T/repo-atlas-harness-api-y75Ezk/`.
- Raw final evaluation: `.codex/evaluation/run-Qk7EE9/report.json`.
- Versioned comparative result:
  [R3 baseline](../../../evaluation/baselines/r3-source-snapshots-2026-10-04.json).

The final source SHA-256 is
`0f40e2a73935f3c5a8d0275c87ef9eb223f384d65d5bcc037c2db7982a624732`;
evaluator SHA-256 is
`c993a7bc35e370bd8eccee938825bc3a2e5920d0f0b695d619b3e3668210f350`;
labels SHA-256 is
`845f0243ddd1faa12fa461bf00e4a80c8ebf9d2ea9c5ad9c42c4701c4dbd66f6`.

Measured change: retained-text recall improves from 0/1 to 1/1 with unchanged
numeric budgets and independent labels. The 72-file chain remains 15/71 graph
edges, 0/1 tail retrieval and 0/71 impact recall with correctly reported budget
exhaustion. Distinct-file ranking is deterministic; this corpus does not justify
graph ranking, budget expansion or a real-repository quality claim. `readBytes`
conservatively charges bounded failed attempts and is not a transport counter.

Implementation scope is delivered through reviewable reader/cache/search/LSP and
physical lifecycle boundaries. Runtime, human, full-suite and stable-promotion
acceptance remain open. Do not archive this active change or mark R2–R5 fully
accepted based only on these local checks.

## Runtime and full-suite follow-up (2026-10-05)

The user authorized deletion after assessing lack of impact. Reviewed sites are
fresh task-owned synthetic test directories, detached worktrees inside their own
temporary Git repositories, and regenerable ignored upstream native/client/Web
outputs. No user source, history or unrelated files were deleted. RepoAtlas's
artifact pipeline and smoke homes retain their results. The upstream tracked
checkout remains clean at `5badb15009ae1756c3afe0ae0cef1faafc290ccc`.

Real native execution found `INVALID_TOOL_OUTPUT`: optional undefined fields in an
analysis DTO are rejected by the candidate's lossless-JSON registry. All factories
now project only the returned DTO, omitting absent object fields and rejecting
lossy/executable values. Original execution and authority checks remain unchanged.
The compatibility helper uses the exact installed pnpm and built public CLI,
follows authenticated same-origin browser bootstrap, and retains credentials only
in memory. A task-owned overlay creates real Agents and invokes the actual native
registry without a model request.

| Check | Outcome | Evidence / limitation |
|---|---|---|
| Full unfiltered suite | PASS | 129 passed, 0 failed, 0 skipped; includes all eight previously excluded cases and four output/readiness regressions |
| Typecheck / safety lint | PASS | Full project check; 37 source files scanned; lightweight lint remains limited |
| OpenSpec 1.7.0 strict all-item validation | PASS | 35 items, 0 failures after the output/authentication contract delta |
| Standard source prepack | PASS | Fresh package, 153 entries, output projection present, source/evaluation/reference excluded |
| Fresh offline packed consumer | PASS | Final README and current code; independent package, disabled install scripts, plain Node exports and default/opt-in tool registrations |
| Exact upstream full build | PASS | Installed pnpm 11.7.0, official root build; native addon, host/client declarations, bundler, Desktop welcome and Web frontend; 355 client artifacts |
| Official candidate declarations / Cordis | PASS | Fresh official API and component checks rerun inside compatibility verification |
| Loader / authenticated Web boot | PASS | Public CLI plugin add/config, post-settlement loopback bootstrap and HTTP probe; auth retained; owned process terminated |
| Native tool flow | PASS | Eight real Agent/registry checks: default tools, symbols opt-in, pre-analysis refusal, Harness provider analysis, evidence search, reverse impact, same-cwd session isolation and cancellation |
| Six-case final synthetic evaluation | PASS (integrity gates) | Unchanged labels/budgets; retained-text recall 1/1; 72-file chain stays 15/71 edges, tail query 0/1, impact 0/71 and budget-exhausted |
| Human label / configured LSP / UI / Windows | NOT RUN | Synthetic mocks and native keyless calls do not establish these gates |
| Stable support promotion | NOT APPLICABLE | Candidate is alpha; historical accepted pin unchanged |
| Increment delivery | VERIFIED | Reviewed task increment prepared for the already authorized commit/push on `refactor/repository-intelligence`; final Git/remote head is authoritative |
| Merge / tag / deployment / release | NOT PERFORMED | Outside this increment |

Reproduction commands:

```sh
npm test
npm run typecheck
npm run lint
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 \
  .codex/tools/openspec-bUpUzW/node_modules/.bin/openspec \
  validate --all --strict --no-interactive
# In the clean exact upstream checkout, after locked installation:
node node_modules/pnpm/bin/pnpm.mjs run build
# In RepoAtlas after its build:
REPO_ATLAS_HARNESS_ROOT=/absolute/path/to/deepseek-harness \
  npm run verify:harness-compatibility -- --candidate
npm run verify:built-artifact
```

Retained current evidence:

- Full suite: `.codex/full-runtime-json-tests-2026-10-05.log`.
- Exact pinned full upstream build: `.codex/harness-pinned-build-2026-10-04.log`.
- Final native/authenticated runtime: `.codex/harness-runtime-json-final-2026-10-05.log`.
- Runtime home and `tool-flow.json`: `/var/folders/0l/4wxf7k013_s34b2wkdljpq1r0000gn/T/repo-atlas-harness-smoke-c5BJRN/`.
- Standard prepack: `.codex/artifacts/prepack-runtime-9vBcOl/pack-result.json` and its tarball.
- Final offline consumer: `.codex/artifacts/build-hOY8l5/`.
- Raw evaluation: `.codex/evaluation/run-9Oiwwv/report.json`.
- Versioned [final baseline](../../../evaluation/baselines/runtime-json-output-2026-10-05.json)
  and [candidate gate record](../../../reference/harness-candidate-validation.json).

Final source SHA-256:
`654da576919fddfa63fadfa969ea4caac3beca9d7e1d73f03ee06c3a62dd2412`.
Evaluator and label hashes remain those recorded above. Earlier wrapper timeouts,
readiness parsing failure, HTTP 401, and native JSON rejection are retained as
superseded diagnostics, not successful acceptance evidence. Final checks cover the
fixes; no fixture label or numeric budget was changed to improve the result.
Implementation and automated macOS runtime gates are delivered as a reviewable
branch increment. Human, Windows and stable support gates remain open, so this
change is not archived and the whole R2–R5 roadmap is not marked fully accepted.
