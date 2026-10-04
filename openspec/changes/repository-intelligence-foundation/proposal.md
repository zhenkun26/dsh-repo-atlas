## Why

RepoAtlas needs queryable repository evidence and bounded impact analysis while
DeepSeek Harness develops its own execution, filesystem, and LSP capabilities.
The existing import resolver can select unrelated prefix matches, and structural
export parsing can mistake string initializers for module references.

## What Changes

- Extract deterministic dependency graph construction from analysis.
- Resolve only exact or unambiguous observed relative targets and record unresolved imports.
- Preserve parser provenance and keep fallback-derived edges inferred.
- Add session-owned evidence retrieval and reverse-import impact tools.
- Record an upstream source review and staged product plan separately from accepted compatibility.

## Capabilities

### New Capabilities
- `repository-intelligence`: bounded evidence retrieval and file-level potential impact over session snapshots.

### Modified Capabilities
- `ast-syntax-confirmation`: dependency relationships use parser provenance and reject false export targets.

## Impact

Changes analysis graph construction and adds two native tools. Existing lifecycle
tools, permissions, public exports, and historical compatibility pin remain available.
No dependency, network, persistence, arbitrary execution, or automatic modification
capability is introduced. Live current-Harness compatibility is a separate gate.
