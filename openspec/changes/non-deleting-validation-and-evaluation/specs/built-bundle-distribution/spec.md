## ADDED Requirements

### Requirement: Builds SHALL preserve outputs and isolate artifact freshness

Each build SHALL compile into a newly allocated package tree and retain its result
on success or failure. Only successful compilation and required-output validation
SHALL return a passed build. Normal root dist projection MUST reject symlinks and
existing files absent from the fresh output set before copying. Isolated builds
SHALL not project files into root dist.

#### Scenario: A previous output contains an obsolete file
- **WHEN** normal build finds a dist file absent from the fresh output set
- **THEN** it SHALL fail before projection and preserve existing files

#### Scenario: Compiler reports a type error
- **WHEN** compilation fails
- **THEN** the build SHALL retain a failed record and SHALL not project outputs or report package readiness

### Requirement: Artifact verification SHALL pack only a fresh package tree

Verification SHALL pack a successful isolated build, run no source lifecycle hooks,
and verify both public exports in a fresh offline consumer. It SHALL preserve its
directories and exclude source, tests, labels, references and old root dist files.

#### Scenario: Root dist contains unrelated prior artifacts
- **WHEN** isolated artifact verification runs
- **THEN** its tarball SHALL contain only files from the fresh package tree
