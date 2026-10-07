## Why

Independent review reproduced two defects in the repository-intelligence branch:
a growing file can be read beyond its reserved byte charge before a failed version
check, and formatted/truncated AST module text can resolve to the wrong file.

## What Changes

- Limit each content and root-ignore read to its exact reserved metadata size,
  without refunding failed or cancelled attempts.
- Add optional moduleSpecifierExact provenance; only true permits graph resolution.
- Preserve exact semantic module values within the existing 160 UTF-16 code-unit
  limit; keep summary formatting separate and unverified inputs explicitly unresolved.
- Mark unreliable fallback escapes, newlines and template literals unverified.
- Bump session cache schema so older unmarked AST observations are reread/reparsed.
- Exercise growth/failure/policy/empty-file boundaries, legacy observations/cache,
  and both real compiler and isolated fallback module-identity probes.

## Capabilities

### Modified Capabilities
- `repository-reader`: read cap and reservation consistency.
- `ast-syntax-confirmation`: semantic module identity provenance.
- `repository-intelligence`: explicit unverified module relations.
- `incremental-evidence-cache`: reparse earlier unmarked observations.

## Impact

No dependency, runtime permission, numeric budget or compatibility pin changes.
Old observation producers remain structurally compatible but their unmarked module
values are unresolved. Existing pending acceptance and partial coverage stay explicit.
