## Why

The October plan requires TS/JS application and monorepo evaluation coverage.
The current six synthetic cases do not exercise a multi-layer application or
cross-workspace imports, and the evaluator records missing unresolved imports
without failing a complete-case acceptance gate.

## What Changes

- Add independently authored synthetic mixed TS/JS application and monorepo inputs.
- Label supported static edges, relevant files, reverse impact, unresolved aliases
  and package names, and an unobserved target outside the scanned roots.
- Opt these small cases into complete static-snapshot acceptance, while preserving
  known partial baseline metrics and unchanged default budgets.
- Validate graph references and explicitly exclude unsupported labelled relations.
- Run repository evaluation in the existing Node 22/24 CI, and include push
  events for the active repository-intelligence branch.

## Capabilities

### Modified Capabilities
- `repository-evaluation`: wider synthetic coverage and explicit complete-case gates.

## Impact

Only evaluation tooling, fixtures, regression checks and planning evidence change.
Plugin runtime, dependencies, permissions, compatibility pins and budgets remain.
Labels require human review; this is not real-project, LSP/UI or Windows acceptance.
