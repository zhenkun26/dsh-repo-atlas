## ADDED Requirements

### Requirement: Physical lifecycle boundaries SHALL preserve authorization

The fixed Git adapter and stateless helpers SHALL be separate modules. Existing
public entry points, digest checks, authorization order, uncertain outcomes and
owned-worktree checks SHALL be preserved. Safety lint SHALL limit the privileged
process exception to the fixed adapter. Provider evidence without verified host
mapping SHALL NOT authorize local Git or controlled local checks.

#### Scenario: Existing lifecycle characterization runs
- **WHEN** proposals traverse review, confirmation, verification, commit and landing
- **THEN** their state transitions and approval contracts SHALL remain unchanged

#### Scenario: Remote analysis prepares a proposal
- **WHEN** its repository provider cannot map to the same host-backed workspace
- **THEN** preparation SHALL block before Git adapter access
