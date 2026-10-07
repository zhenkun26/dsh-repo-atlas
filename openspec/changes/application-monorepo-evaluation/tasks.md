## 1. Corpus and contracts

- [x] 1.1 Author mixed TS/JS application and monorepo inputs with independent labels.
- [x] 1.2 Add opt-in complete-case gates and explicit unsupported/unknown checks.
- [x] 1.3 Add sensitivity regressions for missed observations and invalid references.

## 2. Verification and delivery

- [x] 2.1 Run eight-case evaluation and preserve original six-case metrics.
- [x] 2.2 Run full tests, typecheck, lint, fresh package build/imports and strict OpenSpec.
- [x] 2.3 Record exact evidence and limitations in the October plan.
- [x] 2.4 Prepare the verified increment for independent review and authorized branch push.

## 3. Separate acceptance

- [ ] 3.1 Obtain human review of synthetic labels.
- [ ] 3.2 Evaluate real repositories and complete live LSP/UI and Windows gates.


## Local verification snapshot (2026-10-07, before remote delivery)

Base revision: `3cd63065cf12c7ce2dddfee9a6127087118d5d4c`, verified against the
actual remote `refactor/repository-intelligence` head. Working tree was clean
before this increment. Node `24.20.0`, macOS; existing locked dependencies and the
previously installed OpenSpec `1.7.0` were used. No dependency was added or installed.

| Check | Outcome | Evidence / limitation |
|---|---|---|
| `npm test` | PASS | 131 unfiltered tests, zero skipped/failing; includes complete/partial gate sensitivity regressions |
| `npm run typecheck`, `npm run lint`, `git diff --check` | PASS | Existing TypeScript and lightweight safety gates; runtime source is unchanged |
| `npm run verify:built-artifact` | PASS | Fresh retained build, offline install with scripts disabled, root/Harness imports; evaluation inputs are excluded |
| Strict all-item OpenSpec 1.7.0 validation | PASS | 36 items, zero failures; telemetry disabled |
| `npm run evaluate:repository` | PASS | Eight cases, zero gate failures; original six cases preserve all graph/query/impact metrics, configuration, budget status and read charges |
| CI configuration review | PASS | Adds only evaluation and this exact refactor branch's push trigger; token remains `contents: read`; no secret, deployment or publication step |
| `npm run verify:release-preflight` | BLOCKED | Active changes, dirty precommit tree and origin/main drift; existing v0.1.1 release-contract mismatches remain outside this evaluation increment |
| Remote delivery | PREPARED | This is a pre-push snapshot; exact Git remote head and GitHub Actions run are the delivery authority |
| Human labels / real repositories / real LSP/UI / Windows / stable support | OPEN | Synthetic local passes establish none of these acceptances |

Retained local evidence (not included in Git):
- Evaluation report: `.codex/evaluation/run-U8l5J5/report.json`.
- Build/package/offline consumer: `.codex/artifacts/build-c7J2hd/`.
- Test, evaluation and artifact console logs: task workspace
  `/Users/zhenkun/Documents/Codex/2026-10-07/task/dsh-*.log`.

The versioned [eight-case baseline](../../../evaluation/baselines/application-monorepo-2026-10-07.json)
contains only synthetic metrics/configuration/hashes, not private runtime logs,
credentials or source excerpts. The prior six-case labels and all earlier
baselines remain unchanged. The extended corpus retains human-review-pending
provenance. The active change remains open for the separate acceptance gates.
