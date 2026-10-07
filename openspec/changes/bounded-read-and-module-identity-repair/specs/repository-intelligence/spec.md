## ADDED Requirements

### Requirement: Graph resolution SHALL require verified semantic provenance

Only moduleSpecifierExact true SHALL permit local dependency resolution. False
or absent flags SHALL produce an unresolved import with unverified-module-specifier
reason. Legacy producers SHALL remain structurally compatible without their display
text being promoted to precise graph edges.

#### Scenario: A legacy observation lacks the new flag
- **WHEN** its module field names an observed file
- **THEN** graph construction SHALL report it unresolved instead of creating an edge
