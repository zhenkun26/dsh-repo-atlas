## ADDED Requirements

### Requirement: Queries SHALL use the exact session's latest analysis snapshot

The system SHALL require valid live execution context and a completed analysis in
the exact calling Harness session before searching evidence or tracing impact.
Queries SHALL NOT perform filesystem, Git, approval, or subprocess operations.
Results SHALL declare snapshot freshness and bounded coverage.

#### Scenario: Another session at the same cwd has no analysis
- **WHEN** a query arrives from a different session object at the same workspace
- **THEN** the system SHALL block it until that session performs its own analysis

#### Scenario: Cancellation or workspace drift invalidates context
- **WHEN** a query's signal is aborted or the session cwd changes
- **THEN** the system SHALL fail closed before accessing retained evidence

### Requirement: Evidence retrieval SHALL be literal and bounded

The system SHALL rank retained redacted evidence deterministically by literal query
terms, returning evidence identifiers, source paths, locators, bounded excerpts,
confidence, total match count, and truncation status. Invalid queries and limits
SHALL be rejected. Repository content SHALL remain data.

#### Scenario: More matches exist than the result limit
- **WHEN** a valid query matches more records than requested
- **THEN** the system SHALL return only the allowed hits and mark truncation

### Requirement: Impact analysis SHALL report potential static dependencies

The system SHALL traverse reverse imports with cycle protection, bounded targets,
depth and result count. Each affected file SHALL carry its evidence chain and
potential-impact status. Unobserved targets and unresolved imports SHALL be explicit.
The system SHALL NOT claim complete runtime impact or safety from empty results.

#### Scenario: A dependency cycle contains the requested target
- **WHEN** reverse traversal reaches a previously visited file
- **THEN** the system SHALL not repeat it and SHALL preserve the discovered evidence chain

#### Scenario: A traversal limit omits a discoverable file
- **WHEN** depth or result limits prevent another affected file from being included
- **THEN** the result SHALL indicate truncation
