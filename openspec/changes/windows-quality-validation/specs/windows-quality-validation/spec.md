## ADDED Requirements

### Requirement: Windows quality evidence SHALL use a bounded exact-revision workflow

The Windows Node 24 workflow SHALL run the existing full tests, typecheck, safety
lint, evaluation, fresh offline artifact, strict OpenSpec and diff gates. It SHALL
use contents:read, no secrets or deployment/release/upload steps, and a checkout
directory containing a space. It SHALL preserve manual execution and restrict
its normal pull_request bootstrap to the exact same-repository feature branch
`test/native-evidence-windows`, checking that PR's head SHA. It MUST NOT use
pull_request_target, bypass failures or weaken the existing Linux gates.

#### Scenario: Bootstrap before the workflow exists on main
- **WHEN** the approved feature branch opens or updates a normal PR to main
- **THEN** Windows SHALL test its exact head revision without first merging it

#### Scenario: A different or forked PR uses the workflow
- **WHEN** the PR head branch or repository does not match the bootstrap guard
- **THEN** the Windows bootstrap job SHALL not execute that PR's code

#### Scenario: A Windows gate fails
- **WHEN** any required Windows verification fails
- **THEN** the run SHALL fail and Windows acceptance SHALL remain pending

### Requirement: Developer CLI invocation SHALL preserve separate arguments without a shell

Typecheck SHALL launch the workspace compiler entry through the current Node
executable. Artifact verification invoked through npm run SHALL launch the
installed npm-cli.js entry through that same executable, with shell:false,
ignore-scripts packing and offline consumer installation. Paths with spaces MUST
remain single arguments. Missing compiler or npm CLI entries MUST fail clearly
without a command-shim or shell fallback.

#### Scenario: The checked-out repository path contains spaces
- **WHEN** the quality commands execute in that repository
- **THEN** compiler, fresh packing and offline import checks SHALL use the actual entries successfully

#### Scenario: npm CLI context is absent
- **WHEN** the artifact verifier is invoked without its npm run context
- **THEN** it SHALL fail explicitly rather than guess or execute a command shim

### Requirement: Windows directory-link and exact-byte fixture assertions SHALL remain effective

Directory-link safety/build tests SHALL use actual Windows directory junctions
or non-Windows directory symlinks and SHALL not skip their escape, rejection or
unchanged-target assertions. Synthetic Git fixtures that assert exact LF bytes
SHALL set checkout policy only in their own temporary repositories.

#### Scenario: A directory link points outside the fixture
- **WHEN** the safety or build check follows its native link observation
- **THEN** it SHALL reject escape or linked output and preserve the target sentinel
