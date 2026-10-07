# Contributing to RepoAtlas

Thanks for helping improve RepoAtlas. The project is a security-bounded DeepSeek Harness plugin, so changes are reviewed for both behavior and authority boundaries.

## Development setup

- Node.js 22 or newer is required; CI checks Node.js 22 and 24.
- Install the locked dependencies with `npm ci`.
- Run the local gates before opening a pull request:

  ```bash
  npm test
  npm run lint
  npm run verify:built-artifact
  npm run typecheck
  npm run evaluate:repository
  npm run validate:openspec
  git diff --check
  ```

  `npm run validate:openspec` requires the OpenSpec CLI. If it is not already available on `PATH`, use the pinned CLI explicitly:

  ```bash
  OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive
  ```

Build and artifact smoke outputs remain under ignored `.codex/artifacts/`; the
API/compatibility helpers also retain their printed scratch directories. A normal
build rejects stale or foreign dist files instead of deleting them. Use
`npm run build -- --isolated` when root dist must remain untouched.

Repository-intelligence changes should rerun the [labelled corpus](evaluation/README.md)
and explain recall changes. Preserve independent labels and disclose pending human
review, unsupported coverage, and platform limits. A successful evaluation process
does not imply perfect recall. When filesystem deletion is prohibited, the eight
legacy cases identified in [the R1 verification record](openspec/changes/repository-intelligence-foundation/tasks.md)
must remain unexecuted; the selected suite is not a full-suite pass.

Candidate checks use `--candidate` and [reference/harness-candidate.json](reference/harness-candidate.json).
Defaults still require the historical accepted revision; a candidate compile pass
never promotes support or substitutes for Loader/Web, manual LSP or UI acceptance.
The manual compatibility workflow offers separate accepted/candidate targets.
Audit the exact upstream build for deletion before running it under a no-deletion
instruction. Official host TypeScript compilation can establish declaration evidence
without invoking the deleting root/bundler/native wrappers.

## Change boundaries

- Read `docs/security-boundary.md` before changing permissions, Git behavior, or Harness integration.
- New behavior requires a new OpenSpec change under `openspec/changes/`; do not silently extend an active or archived change.
- Keep evidence cache, proposal registry, lifecycle event history, and release/preflight assessments session-only.
- Do not add network, arbitrary Shell, dependency installation, source-workspace writes, remote Git, or persistence without a separately reviewed specification.
- Do not treat a proposal, patch, commit, preflight, or readiness observation as an applied result or authorization.

## Pull requests

Describe the user-visible result, the affected safety boundary, and the exact verification commands. Include relevant OpenSpec artifacts in the same pull request. Keep unrelated formatting or generated files out of the change.

The CI workflow is authoritative for the minimum gates. A failed or unavailable gate should be fixed or explained; it should not be bypassed by weakening tests, lint, type checks, or specs.

## Release work

RepoAtlas is currently source-first and `package.json` remains `private: true`. Follow [the release checklist](docs/release-checklist.md), [support policy](docs/support-policy.md), and [source-first release process](docs/release-process.md) for the separate decisions and approvals required before a tag, package publication, or public release. Public references and integrations should identify RepoAtlas / 代码星图 and link the source repository as described in [NOTICE](NOTICE.md).
