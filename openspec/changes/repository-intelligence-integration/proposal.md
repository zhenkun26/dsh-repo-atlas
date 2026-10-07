## Why

Local-only filesystem checks prevent execution-world adaptation. Cached display
excerpts are also used as source input, and the existing lifecycle implementation
couples repository understanding to privileged Git operations.

## What Changes

- Introduce a bounded read-only reader port and a Harness filesystem adapter.
- Isolate cache identity by provider, preserve full redacted source separately
  from report excerpts, and disclose snapshot freshness and coverage.
- Add bounded optional LSP navigation through the existing Harness service.
- Mechanically extract the fixed Git adapter and stateless lifecycle helpers,
  preserving public entry points and authorization behavior.
- Validate an exact candidate independently of the accepted compatibility pin;
  keep prerelease promotion and manual acceptance as distinct gates.

## Capabilities

### New Capabilities
- `repository-reader`: provider containment, byte caps and cancellation.
- `repository-symbol-navigation`: optional bounded read-only LSP evidence.

### Modified Capabilities
- `repository-intelligence`: source-backed snapshot retrieval and quality metrics.
- `incremental-evidence-cache`: provider and source-material identity.
- `isolated-change-proposals`: adapter boundaries without new authority.
- `harness-public-api-contract`: separate candidate validation.

## Impact

No vector database, language-server manager, generated patches or runtime dependency
is introduced. Existing pins, public lifecycle actions and approval order remain.
No merge, deployment or release is implied by implementation or validation.
