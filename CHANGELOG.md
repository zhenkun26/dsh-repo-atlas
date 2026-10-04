# Changelog

All notable RepoAtlas changes will be documented here. The existing `v0.1.0` tag is an immutable historical source snapshot. The `[0.1.1]` section records the completed source-first GitHub Release; neither section implies npm publication or a supported npm package by itself.

## [Unreleased]

- Add local/Harness read-only repository readers, provider-bound cache compatibility,
  bounded root ignore rules, explicit incomplete discovery and host-mapping guards.
- Retain full redacted source separately from display excerpts; add content
  validation mode, per-source freshness and deterministic search with file diversity.
- Add opt-in `repo_atlas_symbols` through configured Harness LSP with bounded,
  precise UTF-16 navigation, cancellation and fail-closed source validation.
- Extract the fixed Git adapter and stateless lifecycle helpers while preserving
  public exports, authorization and uncertain-outcome behavior.
- Add explicit experimental candidate manifest/API checks and manual workflow
  selection; preserve the historical accepted pin and stable promotion gate.


### Added

- Session-owned `repo_atlas_search` and `repo_atlas_impact` tools expose retained redacted evidence and bounded reverse-import impact with snapshot freshness, evidence chains, and unknown coverage.
- An October repository-intelligence plan and an exact-source review record for Harness `5badb15009ae1756c3afe0ae0cef1faafc290ccc`; current runtime compatibility is not yet validated.
- A synthetic labelled evaluation corpus and reproducible default-budget baseline, including cycle, unresolved, unsupported, redaction, action-budget and retained-text cases; labels remain pending human review.

### Fixed

- Dependency graph construction no longer selects arbitrary filename-prefix or directory-child matches; ambiguous targets remain unresolved.
- Exported string initializers no longer become module references. Graph confidence now distinguishes compiler provenance from structural fallback observations.
- README distinguishes the public repository from the private npm publication setting.
- Build diagnostics use stderr so the prepack hook preserves machine-readable `npm pack --json` output.

### Changed

- Builds compile into fresh retained package trees. Root dist projection rejects stale files and symlinks; isolated mode leaves root dist untouched. Artifact verification packs only fresh outputs and installs into a new offline consumer without lifecycle scripts.
- Artifact, API-contract and compatibility helpers retain their scratch outputs instead of deleting directories; semantic deletion tests and upstream build restrictions remain separate gates.
- v2.18 resolves the analysis workspace from each live Harness invocation, forwards its cancellation signal, and owns proposal state by the exact Harness session object instead of plugin mount cwd.
- v2.19 adds an official public-API type contract at the exact Harness pin, aligns sandbox policy with `{ session, mode }`, and upgrades the manual smoke to a bounded live Web boot and loopback probe.
- v2.20 adds deterministic ESM/declaration output, built package exports, a minimal files allowlist, and offline installed-package imports for both the root and Harness entry.
- v2.21 repairs the official sandbox-policy structural contract for the complete pinned mode vocabulary while preserving confined-only RepoAtlas execution.
- v2.22 repairs the manual Harness compatibility workflow by completing the pinned repository's declared host, client, and Web build before live boot; [workflow run 31895791477](https://github.com/zhenkun26/dsh-repo-atlas/actions/runs/31895791477) passed the exact-pin API and live Web smoke.

### Security

- Missing execution, agent session, absolute session cwd, cancellation signal, configured-root match, or stable per-session cwd now fails closed before repository or lifecycle access.
- Evidence caches, proposal registries, event histories, and preflight/readiness observations remain in-memory and isolated to their owning Harness session.
- Ahead, dirty, declaration-missing, activation-failing, non-loopback, and readiness-timeout Harness checks fail closed before compatibility is claimed; the external build/boot remains manual and outside plugin runtime authority.
- The built artifact remains `private:true`; local build/pack verification performs no npm publication, tag, release, push, deployment, or registry access.

## [0.1.1] - 2026-08-15

### Added

- v2.15 open-source showcase wording and package description for public project evaluation.
- v2.16 bilingual English/Chinese README coverage for onboarding, safety, compatibility, distribution, and governance.
- v2.17 source-first release-candidate alignment, immutable-tag evidence, and manual repository metadata handoff guidance.

### Distribution and release status

- This release remains source-first and keeps `private: true`; it is not an npm publication or compiled distribution.
- The `v0.1.1` tag and [GitHub Release](https://github.com/zhenkun26/dsh-repo-atlas/releases/tag/v0.1.1) point to the reviewed revision `3eb5c0c8c48373dd19a6e0317de8ffb26f0064bc`; the historical `v0.1.0` tag remains unchanged.
- The local preflight passed before the manual release action; preflight itself does not create a tag, GitHub Release, npm publication, deployment, or support SLA.

## [0.1.0] - 2026-08-15

### Added

- v2.11 session-only `inspect-release` readiness observation for managed worktrees.
- Source-first public release baseline: license, contribution and security guidance, CI gates, and release checklist.
- v2.13 source-distribution evaluation: local packed-install smoke, pinned public Harness compatibility manifest, and an explicit manual smoke workflow.
- v2.14 public-release preparation: proposed support policy, source-first release procedure, and read-only candidate preflight.

### Security

- Documented the boundary between advisory lifecycle observations and authorized execution.
- Added responsible disclosure guidance for boundary escapes and sensitive-data exposure.
- Kept external Harness clone/install and compatibility execution outside the RepoAtlas runtime and default quality workflow.

### Distribution and attribution

- The first public version remains source-first and is not an npm publication or compiled distribution.
- RepoAtlas is released under the MIT License; preserve the license notice and disclaimer.
- Public references, integrations, documentation, and derivative projects should identify RepoAtlas / 代码星图 and link to the source repository.

## Release policy

The existing `v0.1.0` tag points to the historical commit `455dbb61d5cabe032e3497ba4d9eeb9c39584662` and remains unchanged. The source-first `v0.1.1` tag and [GitHub Release](https://github.com/zhenkun26/dsh-repo-atlas/releases/tag/v0.1.1) were created for the reviewed commit `3eb5c0c8c48373dd19a6e0317de8ffb26f0064bc`. npm publication, compiled distribution, support policy, and future version compatibility remain separate decisions tracked in [the roadmap](docs/roadmap.md) and [the release checklist](docs/release-checklist.md).
