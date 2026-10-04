## ADDED Requirements

### Requirement: Cache compatibility SHALL include provider and policy identity

Cache compatibility SHALL include reader identity, root ignore-policy fingerprint
and configuration. Full source material SHALL carry a checked redacted-content
hash and evidence reference. Metadata reuse SHALL NOT be called a fresh content
check. Content validation mode SHALL reread source within existing budgets.

#### Scenario: Provider metadata is equal but content differs
- **WHEN** content validation is requested
- **THEN** changed source SHALL replace prior material without mutating the earlier snapshot

#### Scenario: Source material is corrupted or discovery incomplete
- **WHEN** retained source identity is invalid or a path was not observed completely
- **THEN** invalid source SHALL be reread and incomplete discovery SHALL NOT establish deletion
