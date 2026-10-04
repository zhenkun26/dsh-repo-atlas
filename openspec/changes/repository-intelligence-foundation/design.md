## Context

The accepted runtime pin predates the freshly reviewed upstream source. Repository
analysis currently mixes scanning, inference, and dependency resolution, while its
latest snapshot is not exposed through focused native queries.

## Goals / Non-Goals

Goals: evidence-linked queries, conservative graph resolution, bounded output,
exact-session ownership, and source-traceable replanning.

Non-goals: runtime call graphs, alias/package resolution, vector retrieval, durable
indexes, remote execution-world support, lifecycle removal, or a new compatibility claim.

## Decisions

1. Build edges from retained import/re-export observations and scanned text paths.
   Arbitrary text and directory prefixes cannot establish a target. Ambiguous or
   unavailable targets remain unresolved. Compiler provenance permits syntax-confirmed
   edges; structural/unknown provenance remains inferred.
2. Store only the latest completed analysis for queries in the existing WeakMap
   runtime. Existing proposal-manager snapshots retain their separate lifecycle.
3. Query with deterministic lexical scores and reverse-import BFS. Limit query
   length, hit count, targets, depth, affected files, excerpts, and unresolved output.
   BFS returns one discovered evidence path per affected file, not every path.
4. Return explicit snapshot freshness and bounded coverage. No query refreshes files
   or runs Git, and no empty result proves absence of impact.
5. Preserve the accepted compatibility pin and record candidate source hashes in a
   separate review manifest. Source review cannot replace compilation or live boot.

## Risks / Trade-offs

Conservative resolution can reduce recall; unsupported cases are disclosed instead
of guessed. Query results become stale after edits; callers must rerun analysis.
The scanner remains local-only. Fallback syntax observations retain their legacy
status vocabulary, but graph confidence now uses explicit parser provenance.

## Migration Plan

Existing tool names and lifecycle actions remain. New tools become available after
plugin loading and require prior analysis in the same live session. Onboarding now
also produces dependency edges, enabling impact queries without a second goal.

## Validation

Exercise resolver ambiguity, re-export parsing, confidence provenance, cycles,
evidence chains, limits, invalid inputs, isolation, cancellation, and redaction.
Run the existing suite except eight deletion-bearing tests under the active user
restriction. Compile directly into fresh dist without the deleting build wrapper.
Current-Harness API and Loader checks remain explicitly unverified.
