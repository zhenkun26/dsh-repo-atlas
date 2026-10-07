## ADDED Requirements

### Requirement: Earlier unmarked AST caches SHALL be reparsed

The cache schema SHALL invalidate schema-3 entries that predate semantic identity
provenance. Reanalysis SHALL reread and reparse them within the existing budgets
rather than relabel formatted module fields as exact. Current-session isolation
and non-persistence SHALL remain unchanged.

#### Scenario: Metadata matches a schema-3 cache
- **WHEN** follow-up analysis receives its unmarked AST evidence
- **THEN** the cache SHALL be incompatible and covered source SHALL be freshly parsed
