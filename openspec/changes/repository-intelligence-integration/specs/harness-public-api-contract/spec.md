## ADDED Requirements

### Requirement: Experimental candidate checks SHALL remain separate from support

An explicit candidate flag SHALL select only the pinned candidate manifest and
reject revision drift or tracked changes. Candidate official declarations SHALL
cover the filesystem and LSP seams as well as existing tool and policy contracts.
Candidate evidence SHALL NOT update the historical accepted manifest or establish
Loader, Web, manual interaction or stable support without those independent gates.

#### Scenario: Candidate checkout is supplied to the default check
- **WHEN** its revision differs from the accepted pin
- **THEN** validation SHALL fail closed unless the explicit candidate flag is present

#### Scenario: Prerelease declarations compile
- **WHEN** official candidate types are assignable
- **THEN** only the declaration gate SHALL pass; stable promotion and runtime acceptance remain separate
