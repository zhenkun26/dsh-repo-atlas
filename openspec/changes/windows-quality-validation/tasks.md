## 1. Tooling and fixtures

- [x] 1.1 Add the bounded Windows Node 24 workflow and exact-head PR bootstrap.
- [x] 1.2 Use current Node/compiler/npm CLI entries without shell dispatch.
- [x] 1.3 Preserve lint authority exceptions across native separators and regress near misses.
- [x] 1.4 Run real directory-link safety checks without Windows skips and isolate LF fixtures.
- [x] 1.5 Summarize verified LSP/Web machine evidence in the existing rolling plan.

## 2. Verification and delivery

- [x] 2.1 Pass full local tests, typecheck, lint, evaluation, fresh offline artifact and strict OpenSpec.
- [ ] 2.2 Seal the exact candidate and pass independent delta review before push.
- [ ] 2.3 Push non-force and verify real Windows Node 24 plus existing Linux Node 22/24 CI.
- [ ] 2.4 Merge normally only after review/CI and verify the exact resulting main revision.

Windows runtime evidence and remote delivery are pending until their actual runs.
Human labels/UX approval, model-driven turns/streaming, cold restart, real-repository
coverage and stable Harness promotion remain independent open gates.


## Local verification snapshot (2026-10-07, before review/push)

Base source: `b8b4d21c6ba687aa8354d77da419921c97e0088d`.
macOS, Node `24.20.0`; current installed compiler and npm CLI, no new dependencies.

| Gate | Result |
|---|---|
| Full npm test | PASS: 141 cases, zero failures/cancellations/skips |
| Typecheck | PASS: actual workspace compiler via current Node |
| Safety lint | PASS: 37 source files; native-path positive and near-miss negative subprocess regressions |
| Repository evaluation | PASS: all eight cases, hashes/configuration/labels and numerical metrics unchanged apart from elapsed time |
| Fresh packed offline consumer | PASS: 153 staged files, both exports and default/opt-in tools; hooks disabled, no publication |
| Strict installed OpenSpec 1.7.0 | PASS: 38 items, zero failures |
| Workflow structure / diff | PASS: installed YAML parser, exact head/branch/repository guard, read-only scope, complete gates and patch formatting |
| Missing npm/compile context | PASS: explicit verifier failure before build allocation; missing workspace compiler blocked rather than using PATH |
| Independent review / Windows / Linux remote CI / merge | PENDING: no new remote run or delivery yet |

Reproduction: `npm test`, `npm run typecheck`, `npm run lint`,
`npm run evaluate:repository`, `npm run verify:built-artifact`, installed OpenSpec
`validate --all --strict --no-interactive`, and `git diff --check`.
Fresh offline output is retained under `.codex/artifacts/build-O4bwpd/`; raw
evaluation under `.codex/evaluation/run-v7thSL/`. Console logs and raw native
profiles remain outside version control. Git/PR/Actions state will identify the
reviewed exact candidate and authoritative remote outcomes. No active change is
archived by this local verification record.
