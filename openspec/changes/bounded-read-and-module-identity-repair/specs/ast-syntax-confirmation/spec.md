## ADDED Requirements

### Requirement: Semantic module identity SHALL remain separate from display

AST observations SHALL retain the optional moduleSpecifier field and add optional
moduleSpecifierExact. True SHALL mean the semantic value is unchanged within the
existing 160 UTF-16 code-unit limit. Summary formatting SHALL not define module
identity. The compiler SHALL use decoded string text; the structural parser SHALL
mark escapes, multiline and non-static literals unverified rather than partially decode them.
Secret-like, transformed, oversized or redaction-placeholder values SHALL not be exact.

#### Scenario: Two observed files differ only in consecutive spaces
- **WHEN** the module literal identifies the file with two spaces
- **THEN** its exact semantic field SHALL retain both spaces even if the summary folds them

#### Scenario: A literal exceeds the semantic limit
- **WHEN** a file matches its truncated display prefix
- **THEN** the truncated field SHALL remain unverified and SHALL not authorize resolution
