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

### Requirement: Native tool outputs SHALL preserve JSON values

Every Harness tool factory SHALL normalize only its returned DTO for the native
lossless-JSON registry. It SHALL omit undefined object fields without mutating the
producer, and preserve valid JSON scalar values. It SHALL reject undefined array
items, holes, lossy numbers, non-plain objects, accessors, symbols and cycles.
Execution and authority checks SHALL retain their existing order and meaning.

#### Scenario: Analysis returns absent optional fields
- **WHEN** an otherwise valid analysis DTO contains undefined object fields
- **THEN** the native registry SHALL receive an equivalent DTO without those fields and accept the result

#### Scenario: Tool output cannot be represented without loss
- **WHEN** an output contains a lossy or executable value
- **THEN** output normalization SHALL fail rather than silently coerce it

### Requirement: Candidate runtime proof SHALL retain authentication

Runtime verification SHALL use the exact installed package manager and built public
CLI at the selected revision, a fresh task-owned home and a loopback listener.
Bootstrap credentials and cookies SHALL remain in memory. Candidate verification
SHALL exercise real Agents through the native tool registry without a model request.

#### Scenario: Harness startup requires browser authentication
- **WHEN** its readiness URL carries a bootstrap credential
- **THEN** verification SHALL follow the same-origin cookie bootstrap without disabling auth or logging the credential

#### Scenario: Candidate native tools settle
- **WHEN** the real registry executes analysis, search and impact on a synthetic fixture
- **THEN** checks SHALL establish provider use, same-cwd session isolation and cancellation separately from human UI and configured LSP acceptance
