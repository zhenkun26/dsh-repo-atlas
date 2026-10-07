## Why

Current quality CI runs only on Ubuntu. Windows command shims and native path
separators prevent the developer gates from establishing equivalent evidence,
and a directory-link build regression currently skips that platform.

## What Changes

- Add a minimal read-only Windows Node 24 workflow using the existing quality gates.
- Bootstrap its first run through a normal, exact-head, same-repository PR from
  `test/native-evidence-windows`; retain workflow_dispatch for later manual runs.
- Run compiler/npm JavaScript entry points through the current Node executable
  with separate arguments and shell:false, including a checkout path with spaces.
- Normalize safety-lint path separators without broadening its exceptions.
- Exercise actual Windows directory junctions without skips; retain safety assertions.
- Make exact-byte synthetic Git fixtures use repository-local LF checkout policy.
- Record bounded native LSP/Web evidence in the existing rolling plan.

## Capabilities

### New Capabilities
- `windows-quality-validation`: developer command portability and bounded CI evidence.

### Modified Capabilities
- `ci-lint-portability`: preserve exact source policy across native path separators.

## Impact

Development tooling and synthetic fixtures only. No product source, dependency,
lockfile, runtime capability or accepted/candidate compatibility pin changes.
No release, deployment, secret use, model invocation or support promotion. Actual
Windows Actions results, independent review and remote delivery remain separate
from local macOS verification; human acceptance remains pending.
