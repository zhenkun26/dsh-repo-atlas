## ADDED Requirements

### Requirement: Reader caps SHALL not exceed scanner reservations

The scanner SHALL reserve and charge the complete maximum content I/O before each
read. The byte cap passed to either repository reader SHALL equal the validated
metadata size reserved within the remaining total and per-file budgets.
Root ignore-policy reads SHALL obey the same rule. Failed or cancelled attempts
SHALL retain their reservations.

#### Scenario: A file grows between scanner and reader stat
- **WHEN** reader metadata exceeds the already reserved cap
- **THEN** the reader SHALL reject before content I/O and the scanner SHALL not authorize a larger read

#### Scenario: Version validation fails after content I/O
- **WHEN** the bounded read has already transferred content
- **THEN** the full reservation SHALL remain charged and a later attempt exceeding the remaining total SHALL be denied

#### Scenario: A stable file is empty
- **WHEN** both metadata checks report zero bytes
- **THEN** its zero-cap read SHALL remain valid without permitting growth beyond the reservation
