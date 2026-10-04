## Context

Deleting dist before compilation and cleaning temporary directories after smoke
checks conflict with the active user restriction. Simply omitting cleanup could
pack obsolete files from prior builds. Query defaults also need a measured baseline.

## Goals / Non-Goals

Goals: fresh packable artifacts, existing package exports, preserved unrelated
outputs, retained failures, and independently labelled synthetic evaluation.

Non-goals: deleting source/worktrees, rewriting their tests, new dependencies,
upstream source patches, promotion of compatibility pins, or changing query budgets.

## Decisions

- Compile into `.codex/artifacts/build-*/package/dist` with noEmitOnError. A failed
  result is retained and never returned as a successful build.
- Copy fixed metadata into the staging package and omit source lifecycle scripts
  and development-only dependencies from its manifest. Normalize source-map source
  paths so staging/host paths are not exposed.
- Normal build projects generated files into root dist only after rejecting symlinks
  and any existing file absent from the new output set. Isolated mode leaves root
  dist alone. Root projection is not atomic; an I/O failure may partially update
  declared outputs, is reported as failed, and cannot authorize packaging.
- Artifact smoke packs only the fresh package, disables lifecycle scripts, and uses
  a new offline consumer. All resulting directories remain for inspection.
- Existing API/compatibility helpers retain scratch directories. This does not
  establish that their external dependencies or current upstream builds are safe
  to execute under the restriction.
- Labelled corpus roots exclude labels. Generators describe a known 72-file chain
  and retained-text boundary; expected results are authored independently of the
  algorithm outputs. Reports disclose pending human review and metric denominators.

## Risks / Trade-offs

Retained builds consume disk; user-managed cleanup is required. A stale root dist
now blocks normal build/prepack rather than being silently deleted. Offline packed
consumer checks establish package behavior, not Harness Loader activation. Synthetic
measurements do not establish real-repository recall or stable latency. Windows
requires separate execution evidence.

## Validation

Use actual compiler fixtures for independent runs, stale file preservation,
failure records, ordinary dist projection and symlink rejection. Run fresh packed
offline imports and the selected legacy suite. Evaluate labelled recall, reference
integrity, redaction and partial-state detection without raising budgets to fit labels.
