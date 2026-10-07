## Context

Existing corpus reports measure six bounded cases and preserve their low recall.
Application and workspace coverage is missing. An evaluator that only rejects
false edges cannot detect regressions that erase all expected edges or aliases.

## Decisions

- Author input and expected labels before running the evaluator. Labels remain
  outside repository roots and retain agent-authored, human-review-pending status.
- Model a mixed TS/JS routing/service/utility application and a two-app workspace
  with direct cross-package imports, re-exports, configured aliases and package exports.
- Unsupported aliases/package names remain unresolved. The labelled affected set
  covers supported static imports only; it is not a runtime impact claim.
- Complete-case gates reject missing labelled edges/files/impact, truncated impact
  and unresolved-set mismatches. Explicit unknown-target expectations match exactly.
- All cases reject unsupported resolved relations and invalid graph references.
  Existing intentionally partial cases keep their measured recall without new minima.
- Record the gate module hash in addition to evaluator, labels, source and input hashes.
  Keep previous baselines unchanged and record a separate eight-case baseline.

## Validation

Run gate sensitivity tests, the full labelled corpus and project quality gates.
Check both new complete cases and compare the original six cases against their
previous metrics. Package validation must continue excluding evaluation sources.
Human review, real-repository generalization, live LSP/UI, Windows and stable
Harness support remain separate open gates. No corpus source is executed.
