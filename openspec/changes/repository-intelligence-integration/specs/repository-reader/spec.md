## ADDED Requirements

### Requirement: Repository readers SHALL preserve execution-world boundaries

Readers SHALL expose only read-only listing, metadata and bounded byte reads. The
core SHALL enforce scope, sensitive paths, cancellation and budgets. Providers
SHALL validate canonical containment without interpreting opaque target keys as
host paths. A selected provider failure SHALL NOT trigger local fallback.

#### Scenario: Provider workspace does not exist on the host
- **WHEN** a valid Harness provider supplies the workspace
- **THEN** analysis SHALL use only that provider and return repository-relative evidence

#### Scenario: Provider changes within a session
- **WHEN** a new analysis uses a different provider identity
- **THEN** cached evidence SHALL be incompatible and local Git SHALL require verified host mapping

#### Scenario: Cordis returns fresh wrappers around one service
- **WHEN** repeated lookups return distinct traced proxies for the same underlying service
- **THEN** cache identity SHALL remain stable while I/O SHALL preserve the caller-bound proxy context

#### Scenario: Directory listing is incomplete or unsafe
- **WHEN** listing fails or includes unsafe names or external targets
- **THEN** analysis SHALL report partial discovery and SHALL NOT infer cached file deletion

### Requirement: Root ignore policy SHALL be bounded and conservative

The reader core SHALL apply a documented positive-pattern subset of root
.gitignore, limited to 16 KiB, 128 supported rules and 256 characters per rule.
Policy reads SHALL count against action and byte budgets even for scoped analysis.
Negation, escapes, character classes, whitespace patterns and nested ignore files
SHALL be disclosed as unsupported coverage. Sensitive paths and explicit exclusions
SHALL remain independent policy boundaries. Matching SHALL avoid regex backtracking.
Directory traversal and per-directory listing processing SHALL be capped.

#### Scenario: Root policy exceeds its cap or changes during read
- **WHEN** the policy cannot be read and verified within its bound
- **THEN** discovery SHALL fail closed and report partial coverage

#### Scenario: Supplied source text targets an ignored file
- **WHEN** parsing or searching uses already-provided source text
- **THEN** the same scope and ignore policy SHALL still apply

#### Scenario: A configured service is inactive
- **WHEN** Harness exposes a configured filesystem whose providing service is inactive
- **THEN** analysis SHALL block before provider I/O and SHALL NOT fall back locally

#### Scenario: Backend reading fails after consuming bytes
- **WHEN** a bounded read attempt fails or loses its version guard
- **THEN** its reserved byte charge SHALL remain in the total budget
