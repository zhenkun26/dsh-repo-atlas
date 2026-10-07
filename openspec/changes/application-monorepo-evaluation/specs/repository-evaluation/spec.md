## ADDED Requirements

### Requirement: Complete synthetic cases SHALL enforce labelled static coverage

Evaluation SHALL include a mixed TS/JS application and a monorepo with direct
cross-workspace imports, re-exports, aliases and workspace package names. Their
labels SHALL remain independent of observed outputs, outside scanned inputs, and
marked agent-authored with human review pending. Complete cases SHALL reject
missing labelled edges, relevant retrieval files, affected files, unexpected
affected files, truncated impact and unresolved-import set mismatches.

#### Scenario: Static observations disappear from a small complete case
- **WHEN** an expected edge, relevant file, affected file or unresolved alias is absent
- **THEN** the evaluator SHALL retain the metrics and fail that case's gate

#### Scenario: A stress case remains partial within the default budgets
- **WHEN** the existing budget-chain case reports low recall and expected exhaustion
- **THEN** evaluation SHALL preserve that result without changing labels or budgets or imposing the complete-case minimum

### Requirement: Evaluation SHALL distinguish unsupported and unobserved relations

Every case SHALL reject resolved edges corresponding to explicitly labelled
unsupported relations and SHALL validate graph source/target paths and evidence
references in the retained snapshot. Cases with unknown-target expectations SHALL
compare them exactly. Reports SHALL identify the gate module hash.

#### Scenario: A configured alias is present in the workspace
- **WHEN** its target exists but alias resolution is outside current graph coverage
- **THEN** evaluation SHALL require the labelled unresolved observation and exclude an invented resolved edge

#### Scenario: An impact target is absent from the snapshot
- **WHEN** the case labels that target as unknown
- **THEN** evaluation SHALL require that exact unknown target without treating it as a resolved dependency
