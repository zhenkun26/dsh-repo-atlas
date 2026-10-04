## 1. Assessment and planning

- [x] 1.1 Restore RepoAtlas and inspect baseline, policies, tests, and lifecycle scope.
- [x] 1.2 Freshly clone current Harness and record source revision and audited hashes.
- [x] 1.3 Compare Repomix, Aider, Serena, and GitNexus and write the staged plan.

## 2. Repository intelligence foundation

- [x] 2.1 Extract conservative dependency graph construction and fix export parsing.
- [x] 2.2 Record parser provenance and preserve inferred fallback graph confidence.
- [x] 2.3 Add bounded evidence search and reverse-import impact analysis.
- [x] 2.4 Integrate queries into exact-session Harness state without new I/O authority.
- [x] 2.5 Add regression tests and bilingual usage documentation.

## 3. Verification

- [x] 3.1 Record final local suite, typecheck, lint, compile/import, and diff checks.
- [x] 3.2 Validate OpenSpec with the project CLI if available (1.7.0 follow-up below).
- [ ] 3.3 Run current-Harness official declarations, Loader/Web smoke, and manual interaction after a compliant build/verification path is established; report any remaining deletion-dependent checks separately.

Items 3.2–3.3 are explicit gates, not implied passes. Full product roadmap stages
R2–R5 are outside the completed R1 implementation. Do not archive this change or
promote the candidate compatibility pin while the relevant gates remain open.


## Verification record (2026-10-04)

Environment: macOS, Node 24.20.0. Only existing locked project dependencies were
installed, with lifecycle scripts disabled and no lockfile change.

| Check | Outcome | Evidence / limitation |
|---|---|---|
| Selected local suite | PASS | 86 tests passed, including six new intelligence regressions; eight deletion-bearing legacy cases excluded |
| `npm run typecheck` | PASS | Full src/test TypeScript check |
| `npm run lint` | PASS | Existing lightweight safety lint, 29 source files; not a comprehensive security audit |
| `node_modules/.bin/tsc --project tsconfig.build.json` | PASS | Direct compiler invocation; deleting build wrapper not run |
| Plain Node root/Harness built imports and tool flow | PASS | Four tools registered; fixture search returned nine matches and impact found `src/index.ts` for `src/server.ts` |
| `git diff --check` | PASS | Source and documentation whitespace check |
| Fresh upstream checkout | PASS | Exact `5badb15009ae1756c3afe0ae0cef1faafc290ccc`; clean tracked source |
| `npm run validate:openspec` | BLOCKED | `openspec: command not found`; no undeclared CLI installed |
| Full unfiltered suite / packed artifact gate | BLOCKED | Existing scripts delete files; the user's active instructions prohibit filesystem deletion |
| Current upstream official declaration compilation | BLOCKED | Built upstream declarations unavailable; current build path includes prohibited deletion |
| Current upstream Loader/Web smoke | BLOCKED | Upstream build/smoke not run under the deletion restriction |
| Manual Harness interaction | NOT RUN | No claim of UI acceptance |
| Windows execution | NOT RUN | macOS results do not establish Windows support |
| Push / release | NOT PERFORMED | Current increment remains local; no remote authorization |

Selected suite command:

```sh
node --test --experimental-strip-types \
  --test-skip-pattern='changed and deleted paths|report export requires|scanner parse-ast honors|patch verification runner|node Git adapter' \
  test/*.test.ts
```

Excluded cases: two analysis tests (file deletion and export cleanup), one scanner
AST test (temporary cleanup), two plugin verification tests (temporary cleanup),
and three real Git adapter tests (worktree removal/temporary cleanup). Tests were
not rewritten to hide or disable deletion. The selected Node runner reports 86
executed cases; pattern-excluded cases do not appear in its skipped counter.

R1 implementation is ready for review as a local increment. The new candidate
Harness pin is **not accepted**. OpenSpec CLI validation and current-Harness
runtime acceptance remain open; the change is not archived.


## External-review follow-up (2026-10-04)

- [x] Recheck remote HEAD/release and the upstream dynamic-tool-update contract.
- [x] Mark the README visibility finding resolved by R1 (`71e3231`).
- [x] Revise R2 priorities: non-deleting artifact pipeline and labelled evaluation corpus first.
- [x] Separate semantic deletion tests, upstream build prerequisites, and missing OpenSpec CLI.
- [x] Document stable formal-support promotion versus experimental candidate validation.
- [x] Record conditional early adapter/helper extraction and the dynamic-tool watch list.

This follow-up changes planning documents only. None of the new R2 work has run;
the R1 verification record above remains historical evidence, not a rerun. Review
validation: document links/consistency and `git diff --check`; no runtime tests are
needed for these prose-only changes. No push, dependency install, or upstream
checkout modification is part of this follow-up.

## Validation follow-up (2026-10-04)

The user approved installing the documented OpenSpec CLI 1.7.0 in an isolated
task directory with installation scripts disabled. Strict all-item validation now
passes: 35 items including the current integration change, with telemetry disabled.
This closes the CLI prerequisite without rewriting the earlier blocked record.

The current integration independently passes official candidate declarations and
provider/source/LSP regressions; see [its record](../repository-intelligence-integration/tasks.md).
Historical pins and original measurements are preserved. Full deletion-bearing
suite and upstream runtime acceptance remain open; no active change is archived.
