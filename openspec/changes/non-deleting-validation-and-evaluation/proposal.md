## Why

Current build and verification cleanup deletes outputs, preventing local execution
under the active filesystem restriction. R3 ranking and budget decisions also lack
an independent labelled baseline.

## What Changes

- Compile each build into a fresh task-owned package tree and retain its result.
- Preserve normal dist exports through a checked projection; reject stale/foreign
  output paths and symlinks without removing them.
- Pack and install only the fresh isolated package during artifact verification.
- Retain API/compatibility helper directories rather than deleting them.
- Add an independently authored synthetic corpus and reproducible evaluation reports.

## Capabilities

### New Capabilities
- `repository-evaluation`: labelled synthetic baseline with explicit metric limits.

### Modified Capabilities
- `built-bundle-distribution`: fresh isolated build, non-deleting projection and packaging.

## Impact

Development tooling and evaluation data change. No runtime budget, tool authority,
public exports, dependency, or accepted Harness pin changes. Deletion-dependent
legacy tests and upstream build/activation remain separate unresolved gates.
