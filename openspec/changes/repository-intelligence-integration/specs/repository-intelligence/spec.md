## ADDED Requirements

### Requirement: Retrieval SHALL use bounded redacted source snapshots

Full source material SHALL remain session-only, byte-bounded and separate from
report excerpts. Search SHALL use deterministic lexical scores with source-file
diversity. Results SHALL identify snapshot freshness and per-source validation.
Partial graph coverage SHALL NOT imply no change impact.

#### Scenario: Query matches beyond the display excerpt
- **WHEN** retained complete source contains a match after the excerpt boundary
- **THEN** search SHALL return the source evidence id and matching line locator

#### Scenario: Large repository exceeds unchanged defaults
- **WHEN** budgets prevent source or graph coverage
- **THEN** outputs and comparative evaluation SHALL retain partial and low-recall results
