## MODIFIED Requirements

### Requirement: The system SHALL distinguish syntax confirmation from text inference

Dependency relationships SHALL use parser provenance. Only compiler-parsed
import/re-export observations MAY establish syntax-confirmed edges; structural or
unknown provenance SHALL remain inferred. Resolved targets MUST be observed text
files selected by exact or unambiguous extension/index resolution. Unsupported,
ambiguous, and unobserved targets SHALL remain unresolved. Exported string
initializers MUST NOT become module references.

#### Scenario: Compiler-backed relative import has one observed target
- **WHEN** a compiler import identifies an unambiguous relative source file
- **THEN** the graph SHALL return one syntax-confirmed edge with its evidence id

#### Scenario: A fallback observation identifies a relative target
- **WHEN** only bounded structural parser evidence supports an edge
- **THEN** the graph SHALL mark that edge inferred

#### Scenario: A directory contains an arbitrary child but no index
- **WHEN** a relative import names the directory
- **THEN** the graph SHALL leave it unresolved rather than selecting that child

#### Scenario: An exported variable contains a path string
- **WHEN** source declares `export const target = './fake'`
- **THEN** the parser SHALL NOT emit an import or re-export reference to that string
