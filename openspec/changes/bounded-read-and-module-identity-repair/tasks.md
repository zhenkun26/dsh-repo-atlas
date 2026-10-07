## 1. Repair and regressions

- [x] 1.1 Match content and root-ignore read caps to reservations.
- [x] 1.2 Preserve exact module identity and explicitly reject unverified relations.
- [x] 1.3 Invalidate schema-3 caches and reparse legacy AST observations.
- [x] 1.4 Verify growth, post-read failure, policy, zero-size and parser identity regressions.

## 2. Verification and delivery

- [x] 2.1 Run full tests, typecheck, lint, strict OpenSpec and fresh packed consumer.
- [x] 2.2 Run the real installed compiler probe and exact candidate declarations/runtime.
- [x] 2.3 Record a fresh eight-case baseline without rewriting previous results or labels.
- [x] 2.4 Prepare the independent repair commit for exact review before push and merge.

Human labels, real LSP/UI, Windows and stable support remain separate open gates.


## Local repair verification snapshot (2026-10-07, before remote delivery)

Parent evaluation candidate: `187b4459608105bf2c172dfcec9a2fceac7bea07`.
Node `24.20.0`, macOS. Project TypeScript `7.0.2` provides its native CLI;
the actual JavaScript compiler probe uses already installed official Harness
TypeScript `6.0.3` in a fresh temporary source copy. All existing inputs, labels,
numeric budgets, dependencies and accepted compatibility revision are preserved.

| Check | Outcome | Evidence / limit |
|---|---|---|
| `npm test` | PASS | 139 unfiltered cases, 0 failures/skips; growth, version failure, cancellation, root policy, zero/exact sizes and legacy cache/observations |
| Isolated fallback identity probe | PASS | 11 checks; no TypeScript API available, actual bounded-structural parser asserted |
| Real compiler identity probe | PASS | 9 checks; TypeScript 6.0.3 API and actual typescript-compiler provenance asserted |
| Typecheck / safety lint / diff | PASS | Existing compiler gate and 37-source-file lightweight lint |
| Strict OpenSpec 1.7.0 | PASS | 37 items, 0 failures; telemetry disabled |
| Fresh build/pack/offline consumer | PASS | Root/Harness imports, scripts disabled; retained outputs, no publication |
| Exact candidate API / Cordis / Loader / authenticated Web / native tools | PASS | Clean `5badb15009ae1756c3afe0ae0cef1faafc290ccc`; reused official build, 8 native tool checks |
| Eight-case evaluation | PASS | All numerical case metrics, configuration, labels and read charges identical; runtime source hash changes accurately |
| Remote CI / independent repair review / merge | PENDING | This snapshot precedes remote delivery; exact Git/PR/Actions state is authoritative |
| Human labels / real LSP/UI / Windows / stable support | OPEN | No new acceptance claim |

Reproduction commands:

```sh
npm test
npm run typecheck
npm run lint
node scripts/verify-module-identity.mjs --fallback
node scripts/verify-module-identity.mjs --compiler reference/deepseek-harness/node_modules/typescript
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 .codex/tools/openspec-bUpUzW/node_modules/.bin/openspec validate --all --strict --no-interactive
npm run build
npm run verify:built-artifact
REPO_ATLAS_HARNESS_ROOT=/absolute/path/to/clean/exact/deepseek-harness npm run verify:harness-compatibility -- --candidate
npm run evaluate:repository
git diff --check
```

Retained local evidence:
- Source build: `.codex/artifacts/build-CgLuVv/`.
- Offline packed consumer: `.codex/artifacts/build-sJnQHw/`.
- Raw evaluation: `.codex/evaluation/run-RYw1nE/report.json`.
- Fallback probe: task temporary `repo-atlas-module-identity-yoZ11Z/`.
- Compiler probe: task temporary `repo-atlas-module-identity-GQSxLk/`.
- Native runtime: task temporary `repo-atlas-harness-smoke-zgzDRs/`.
- Console logs: task workspace `dsh-repair-*.log`; none are committed.

The [versioned repair baseline](../../../evaluation/baselines/budget-module-identity-2026-10-07.json)
contains synthetic metrics and hashes, without private runtime logs or credentials.
Old baselines stay immutable. The candidate [verification manifest](../../../reference/harness-candidate-validation.json)
preserves its October 5 record and appends this repair's rerun.
