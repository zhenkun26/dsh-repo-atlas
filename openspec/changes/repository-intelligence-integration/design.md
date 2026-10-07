## Context

R1 queries and R2 artifact/corpus foundations are delivered. The remaining work
needs executable reader, source, optional symbol and lifecycle boundaries.

## Decisions

- Readers receive repository-relative paths. The core never interprets opaque
  provider keys or execution-world paths as host paths.
- Core policy uses lexical containment, scope, sensitive-path and byte/action
  budgets. The backend additionally verifies canonical containment and rejects
  repository-owned symlink components before each operation.
- A selected provider never silently falls back to Node reads on failure.
  Auto mode uses Harness fs when present, otherwise the existing local reader.
- Cache compatibility includes provider object/root identity and opaque versions.
  Missing or incomplete discovery cannot establish source deletion.
- Remote evidence cannot authorize local Git lifecycle operations unless the
  provider explicitly maps the workspace to the same host-backed files.
- Full redacted source is session-only and bounded. Display excerpts are never
  treated as complete parse/search input. Queries remain snapshots without I/O.
- LSP remains opt-in and uses the host's configured service, cancellation, bounded
  results and precise UTF-16 locations. No language server or daemon is installed.
- Physical lifecycle extraction preserves fixed argv, public re-exports, digests,
  approval ordering, uncertain outcomes and owned-worktree checks. The safety lint
  exception moves to the specific adapter rather than expanding to a directory.
- Candidate declarations, activation and recorded tool flows stay separate from
  formal stable support promotion and human UI acceptance.

## Validation

Use local/virtual provider parity, containment and cancellation regressions,
cross-provider cache rejection, full-source boundary cases, deterministic retrieval,
LSP absence/malformed/external-result cases and unchanged lifecycle tests. Rerun
the labelled corpus and fresh packed consumer gate. Record exact revisions and
retained evidence. Do not call constrained or synthetic passes full live acceptance.
