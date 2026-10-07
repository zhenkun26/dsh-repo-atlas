## MODIFIED Requirements

### Requirement: The safety lint SHALL enumerate source files using the declared Node.js toolchain

`npm run lint` MUST recursively scan regular files below `src/` without requiring
`rg` or another undeclared executable. It MUST preserve deterministic file
ordering, the existing forbidden side-effect token policy, exact adapter/reporting
exceptions and nonzero failure behavior. Native separators SHALL be normalized
only for policy matching so Windows paths receive the same existing exceptions;
reported filenames SHALL remain native. Near-miss names MUST NOT gain exceptions.

#### Scenario: Clean runner without ripgrep
- **WHEN** a clean Node.js 22 or 24 runner executes npm ci followed by npm run lint and rg is unavailable
- **THEN** lint SHALL succeed for the current source and report its scanned count

#### Scenario: Forbidden source token still fails the lint
- **WHEN** a source file contains a forbidden side-effect token outside the existing exceptions
- **THEN** lint SHALL retain failure status and report the violating file

#### Scenario: Source scope remains bounded
- **WHEN** the repository contains files outside src
- **THEN** lint SHALL not scan them as source inputs

#### Scenario: Windows uses backslash-separated native paths
- **WHEN** the original allowed adapters/reporting file is enumerated on Windows
- **THEN** only its existing exception SHALL apply and unrelated near-miss files SHALL fail
