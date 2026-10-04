## ADDED Requirements

### Requirement: Evaluation labels SHALL remain independent of scanned inputs

The corpus SHALL keep labels outside repository scan roots, identify their
provenance and review status, and record labelled expected files and relationships
independently of observed algorithm results. The evaluator SHALL not execute corpus code.

#### Scenario: A case uses an alias or unsupported language
- **WHEN** graph coverage excludes its relationship
- **THEN** evaluation SHALL disclose that limitation without inventing a resolved edge

### Requirement: Evaluation SHALL preserve bounded baseline results

Reports SHALL record input, source, label and evaluator hashes, configuration,
platform, reference integrity, redaction, budget status, precision/recall and timing.
Reports SHALL preserve low-recall results and distinguish null denominators from
perfect scores. Reports SHALL not imply human-reviewed benchmarks or fresh-line verification.

#### Scenario: Retained evidence omits relevant text
- **WHEN** the labelled query has no hit
- **THEN** the report SHALL preserve zero recall rather than changing the label or budget

#### Scenario: A large case exhausts the default action budget
- **WHEN** analysis reports partial coverage
- **THEN** the report SHALL record both the coverage status and measured graph/query recall
