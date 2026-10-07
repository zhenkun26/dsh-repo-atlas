## ADDED Requirements

### Requirement: Symbol navigation SHALL be optional and bounded

The symbol tool SHALL default to disabled and use only the configured Harness LSP
service. It SHALL bind to exact-session analysis, validate a fresh query source,
forward cancellation, enforce caller timeout/result limits, and report one-based
UTF-16 half-open locations. Provider canonical workspace URIs SHALL define URI
relativization. External, sensitive, unobserved or malformed targets SHALL be filtered.
Source redaction that changes cursor coordinates SHALL block navigation.

#### Scenario: Configured service is missing or the source changed
- **WHEN** the current source or provider cannot be validated
- **THEN** the tool SHALL return unavailable without installing a server or falling back

#### Scenario: Navigation returns a different execution-world root
- **WHEN** canonical locations are returned with resolvedWorkspaceUri
- **THEN** eligible locations SHALL be repository-relative and precise, without host-path interpretation

#### Scenario: Provider ignores cancellation
- **WHEN** the timeout or invocation cancellation occurs
- **THEN** the caller SHALL settle with an unavailable result and request provider cancellation
