import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ChangeProposalManager, createNodeGitWorktreeAdapter, type ChangeProposalVerificationRunner, type GitWorktreeAdapter } from '../src/repository/change-proposal.ts'
import { createConfig } from '../src/config.ts'
import { createEvidence } from '../src/evidence.ts'
import type { AnalysisSession, ChangeProposalRequest, ChangeProposalResult, ChangeProposalVerification, ChangeProposalWorktree } from '../src/types.ts'

const execFileAsync = promisify(execFile)
const fixtureRoot = path.resolve('test/fixtures/complete-repo')
const fakeBaseRevision = 'b'.repeat(40)

class FakeGitAdapter implements GitWorktreeAdapter {
  createCount = 0
  removeCount = 0
  applyPatchCount = 0
  commitCount = 0
  landCount = 0
  inspectCount = 0
  inspectSourceCount = 0
  inspectLandingCount = 0
  commitRevision = 'a'.repeat(40)
  sourceRevision = fakeBaseRevision
  sourceDirty = false
  landingSourceIsAncestor = true
  landingTargetIsAncestor = false
  failLandingInspection = false
  failLandingTarget = false
  dirty = false
  changedPaths: string[] = []
  failDiscovery = false
  failPatch = false
  failCommit = false
  failLanding = false
  failLandingPostcondition = false
  failSourceInspection = false
  failWorktreeInspection = false
  failCommitPostcondition = false
  failPostcondition = false
  identityMismatch = false

  async discover(workspaceRoot: string): Promise<{ repositoryRoot: string; baseRevision: string }> {
    if (this.failDiscovery) throw new Error('git unavailable')
    return { repositoryRoot: workspaceRoot, baseRevision: fakeBaseRevision }
  }

  async create(_repositoryRoot: string, baseRevision: string): Promise<ChangeProposalWorktree> {
    this.createCount += 1
    return { path: path.join(os.tmpdir(), 'repo-atlas-fake-worktree'), identity: `identity-${this.createCount}`, baseRevision }
  }

  async inspect(_repositoryRoot: string, worktree: ChangeProposalWorktree): Promise<ChangeProposalWorktree & { dirty: boolean; changedPaths: string[] }> {
    this.inspectCount += 1
    if (this.failWorktreeInspection) throw new Error('worktree inspection unavailable')
    if ((this.failPostcondition && this.applyPatchCount > 0) || (this.failCommitPostcondition && this.commitCount > 0)) throw new Error('postcondition inspection unavailable')
    return { ...worktree, baseRevision: this.commitCount > 0 ? this.commitRevision : worktree.baseRevision, identity: this.identityMismatch ? 'identity-mismatch' : worktree.identity, dirty: this.dirty, changedPaths: [...this.changedPaths] }
  }

  async inspectSource(repositoryRoot: string, sourceWorkspaceRoot: string): Promise<{ path: string; repositoryRoot: string; revision: string; dirty: boolean }> {
    this.inspectSourceCount += 1
    if (this.failSourceInspection) throw new Error('source inspection unavailable')
    if (this.failLandingPostcondition && this.landCount > 0) throw new Error('source postcondition inspection unavailable')
    return { path: sourceWorkspaceRoot, repositoryRoot, revision: this.sourceRevision, dirty: this.sourceDirty }
  }

  async inspectLanding(repositoryRoot: string, sourceWorkspaceRoot: string, _expectedSourceRevision: string, commitRevision: string): Promise<{ source: { path: string; repositoryRoot: string; revision: string; dirty: boolean }; targetRevision: string; sourceIsAncestor: boolean; targetIsAncestor: boolean }> {
    this.inspectLandingCount += 1
    if (this.failLandingInspection) throw new Error('landing inspection unavailable')
    if (this.failLandingTarget) throw Object.assign(new Error('target commit is not locally resolvable'), { name: 'LandingInspectionError', targetUnavailable: true })
    const source = await this.inspectSource(repositoryRoot, sourceWorkspaceRoot)
    return { source, targetRevision: commitRevision, sourceIsAncestor: this.landingSourceIsAncestor, targetIsAncestor: this.landingTargetIsAncestor }
  }

  async applyPatch(): Promise<void> {
    this.applyPatchCount += 1
    if (this.failPatch) throw new Error('patch rejected by fake Git')
    this.dirty = true
    this.changedPaths = ['src/index.ts']
  }

  async commit(): Promise<string> {
    this.commitCount += 1
    if (this.failCommit) throw new Error('commit rejected by fake Git')
    this.dirty = false
    this.changedPaths = []
    return this.commitRevision
  }

  async land(_repositoryRoot: string, _sourceWorkspaceRoot: string, _expectedSourceRevision: string, commitRevision: string): Promise<string> {
    this.landCount += 1
    if (this.failLanding) throw new Error('landing rejected by fake Git')
    this.sourceRevision = commitRevision
    return this.sourceRevision
  }

  async remove(): Promise<void> {
    this.removeCount += 1
  }
}

function createSession(scope: string[] = ['src']): AnalysisSession {
  return {
    sessionId: 'session-proposal-test',
    workspaceRoot: fixtureRoot,
    goal: {
      intent: 'custom',
      audience: 'reviewer',
      scope,
      outputs: ['proposal'],
      permissions: ['read'],
      success_criteria: ['bounded proposal'],
      confirmed: true,
    },
    plan: { name: 'onboarding', steps: [] },
    scan: { files: [], skipped: [], failures: [], audits: [], budget: { candidateFiles: 0, readBytes: 0, actions: 0, exhausted: false } },
    evidence: [createEvidence('src/index.ts', '全文（已脱敏）', 'export const entry = true', 'confirmed', true)],
    conclusions: [],
    actions: [],
    edges: [],
    ast: [],
    project: {
      name: 'fixture',
      summary: 'fixture',
      techStack: [],
      entries: [],
      coreDirectories: [],
      runtimeConfig: [],
      testConfig: [],
      readingOrder: [],
    },
    interrupted: false,
  }
}

function request(overrides: Partial<ChangeProposalRequest> = {}): ChangeProposalRequest {
  return {
    sessionId: 'session-proposal-test',
    intent: '调整入口结构',
    targets: [{ relativePath: 'src/index.ts', operation: 'modify', rationale: '保持入口职责清晰' }],
    evidenceIds: [],
    ...overrides,
  }
}

function validPatch(replacement = 'new'): string {
  return `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old
+${replacement}
`
}

async function prepareVerifiedCommitDraft(manager: ChangeProposalManager, runner: ChangeProposalVerificationRunner, recipeId: string): Promise<ChangeProposalResult> {
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const patchDraft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const applied = await manager.confirmPatch(patchDraft.proposal?.patch?.patchId ?? '', patchDraft.proposal?.patch?.confirmationDigest ?? '')
  const verified = await manager.verifyPatch({ patchId: applied.proposal?.patch?.patchId ?? '', confirmationDigest: applied.proposal?.patch?.confirmationDigest ?? '', recipeId }, runner)
  return manager.prepareCommit({ proposalId: verified.proposal?.proposalId ?? '', commitMessage: `feat: ${recipeId}` })
}

async function prepareCreatedCommit(manager: ChangeProposalManager, runner: ChangeProposalVerificationRunner, recipeId: string): Promise<ChangeProposalResult> {
  const draft = await prepareVerifiedCommitDraft(manager, runner, recipeId)
  return manager.confirmCommit(draft.proposal?.commit?.commitId ?? '', draft.proposal?.commit?.confirmationDigest ?? '', {
    authorize: async () => ({ allowed: true, auditId: `approval-${recipeId}`, reason: 'approved' }),
  })
}

function passedVerificationRunner(): ChangeProposalVerificationRunner {
  return {
    async run({ recipeId, worktree }): Promise<ChangeProposalVerification> {
      return {
        verificationId: `verification-${recipeId}`,
        auditId: `audit-${recipeId}`,
        recipeId,
        status: 'passed',
        reason: 'verification passed',
        worktreeIdentity: worktree.identity,
        stdout: 'ok',
        stderr: '',
        outputTruncated: false,
        redacted: false,
        redactedMatchCount: 0,
        exitCode: 0,
        signal: null,
        createdAt: new Date().toISOString(),
      }
    },
  }
}

test('proposal lifecycle requires exact confirmation and releases a clean owned worktree', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())

  const pending = await manager.prepare(request())
  assert.equal(pending.status, 'awaiting-confirmation')
  assert.equal(pending.operationStatus, 'proposal')
  assert.equal(adapter.createCount, 0)
  assert.ok(pending.proposal)

  const mismatch = await manager.confirm(pending.proposal?.proposalId ?? '', '0'.repeat(64))
  assert.equal(mismatch.status, 'awaiting-confirmation')
  assert.equal(adapter.createCount, 0)

  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  assert.equal(confirmed.status, 'confirmed')
  assert.equal(confirmed.operationStatus, 'worktree-created')
  assert.equal(confirmed.proposal?.patchApplied, false)
  assert.equal(confirmed.proposal?.commitCreated, false)
  assert.equal(confirmed.proposal?.pushPerformed, false)
  assert.deepEqual(confirmed.proposal?.executionStatus, {
    patch: 'patch-not-applied',
    commit: 'commit-not-created',
    landing: 'landing-not-performed',
    push: 'push-not-performed',
  })
  assert.equal(adapter.createCount, 1)

  const replay = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  assert.equal(replay.status, 'confirmed')
  assert.equal(adapter.createCount, 1)

  const released = await manager.release(pending.proposal?.proposalId ?? '')
  assert.equal(released.status, 'released')
  assert.equal(released.operationStatus, 'released')
  assert.equal(adapter.removeCount, 1)
})

test('lifecycle inspection returns detached session snapshots without touching Git', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())

  const pending = await manager.prepare(request())
  const proposalId = pending.proposal?.proposalId ?? ''
  const inspected = manager.inspect(proposalId)
  assert.equal(inspected.status, 'awaiting-confirmation')
  assert.equal(inspected.operationStatus, 'proposal')
  assert.equal(inspected.proposal?.executionStatus.push, 'push-not-performed')
  assert.equal(adapter.createCount, 0)
  assert.match(inspected.reason, /session-only|live workspace|Git state/)

  if (!inspected.proposal) throw new Error('inspection should include the pending proposal')
  inspected.proposal.targets[0]!.status = 'uncovered'
  inspected.proposal.limitations.push('caller mutation')
  const detached = manager.inspect(proposalId)
  assert.equal(detached.proposal?.targets[0]?.status, 'confirmed')
  assert.equal(detached.proposal?.limitations.includes('caller mutation'), false)

  const rejected = manager.reject(proposalId)
  assert.equal(rejected.status, 'rejected')
  const terminal = manager.inspect(proposalId)
  assert.equal(terminal.status, 'rejected')
  assert.equal(terminal.operationStatus, 'blocked')

  const unknown = manager.inspect('proposal-unknown')
  assert.equal(unknown.status, 'blocked')
  assert.equal(unknown.operationStatus, 'blocked')
  assert.equal(unknown.proposal, undefined)
})

test('lifecycle inspection preserves an uncertain commit state without upgrading it', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const draft = await prepareVerifiedCommitDraft(manager, passedVerificationRunner(), 'uncertain-inspection')
  adapter.failCommitPostcondition = true

  const uncertain = await manager.confirmCommit(
    draft.proposal?.commit?.commitId ?? '',
    draft.proposal?.commit?.confirmationDigest ?? '',
    { authorize: async () => ({ allowed: true, auditId: 'approval-uncertain-inspection', reason: 'approved' }) },
  )
  assert.equal(uncertain.proposal?.commit?.executionStatus, 'commit-creation-unknown')

  const history = manager.history({ proposalId: draft.proposal?.proposalId ?? '' })
  const uncertainEvent = history.events.at(-1)
  assert.equal(uncertainEvent?.phase, 'commit')
  assert.equal(uncertainEvent?.operationStatus, 'commit-blocked')
  assert.equal(uncertainEvent?.executionStatus.commit, 'commit-creation-unknown')

  const inspected = manager.inspect(draft.proposal?.proposalId ?? '')
  assert.equal(inspected.proposal?.commit?.executionStatus, 'commit-creation-unknown')
  assert.equal(inspected.proposal?.executionStatus.commit, 'commit-creation-unknown')
  assert.equal(inspected.proposal?.commitCreated, false)
  assert.equal(inspected.proposal?.pushPerformed, false)
})

test('proposal listing returns bounded deterministic redacted summaries', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const empty = manager.list()
  assert.equal(empty.status, 'available')
  assert.deepEqual(empty.proposals, [])
  assert.equal(empty.total, 0)
  assert.equal(empty.truncated, false)

  const oldest = await manager.prepare(request({ intent: 'oldest proposal' }))
  await new Promise((resolve) => setTimeout(resolve, 2))
  const middle = await manager.prepare(request({ intent: 'middle proposal' }))
  await new Promise((resolve) => setTimeout(resolve, 2))
  const newest = await manager.prepare(request({ intent: 'token = "sk-abcdefghijklmnop"' }))

  const listed = manager.list({ limit: 2 })
  assert.equal(listed.status, 'available')
  assert.equal(listed.total, 3)
  assert.equal(listed.returned, 2)
  assert.equal(listed.truncated, true)
  assert.deepEqual(listed.proposals.map((proposal) => proposal.proposalId), [newest.proposal?.proposalId, middle.proposal?.proposalId])
  assert.equal(listed.proposals[0]?.targetCount, 1)
  assert.equal(listed.proposals[0]?.confirmedTargetCount, 1)
  assert.equal(JSON.stringify(listed.proposals).includes('sk-abcdefghijklmnop'), false)
  assert.equal(JSON.stringify(listed.proposals).includes('src/index.ts'), false)
  assert.equal(JSON.stringify(listed.proposals).includes('workspaceRoot'), false)
  assert.equal(JSON.stringify(listed.proposals).includes('confirmationDigest'), false)
  assert.deepEqual(manager.list({ limit: 2 }).proposals.map((proposal) => proposal.proposalId), listed.proposals.map((proposal) => proposal.proposalId))
  assert.equal(adapter.createCount, 0)
  assert.equal(oldest.status, 'awaiting-confirmation')
})

test('proposal listing rejects invalid limits and preserves uncertain execution states', async () => {
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: new FakeGitAdapter() })
  manager.registerSession(createSession())
  for (const limit of [0, -1, 1.5, 101, Number.NaN]) {
    const invalid = manager.list({ limit })
    assert.equal(invalid.status, 'blocked')
    assert.deepEqual(invalid.proposals, [])
    assert.equal(invalid.returned, 0)
    assert.equal(invalid.total, 0)
  }

  const adapter = new FakeGitAdapter()
  const uncertainManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  uncertainManager.registerSession(createSession())
  const draft = await prepareVerifiedCommitDraft(uncertainManager, passedVerificationRunner(), 'list-uncertain')
  adapter.failCommitPostcondition = true
  await uncertainManager.confirmCommit(
    draft.proposal?.commit?.commitId ?? '',
    draft.proposal?.commit?.confirmationDigest ?? '',
    { authorize: async () => ({ allowed: true, auditId: 'approval-list-uncertain', reason: 'approved' }) },
  )
  const commitCount = adapter.commitCount
  const listed = uncertainManager.list({ limit: 1 })
  const summary = listed.proposals[0]
  assert.equal(summary?.executionStatus.commit, 'commit-creation-unknown')
  assert.equal(summary?.commit?.executionStatus, 'commit-creation-unknown')
  assert.equal(summary?.commitCreated, false)
  assert.equal(summary?.executionStatus.push, 'push-not-performed')
  assert.equal(adapter.commitCount, commitCount)
})

test('lifecycle history records legal transitions and excludes read-only or no-transition calls', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())

  const pending = await manager.prepare(request())
  const proposalId = pending.proposal?.proposalId ?? ''
  const initial = manager.history({ proposalId })
  assert.equal(initial.status, 'available')
  assert.equal(initial.total, 1)
  assert.equal(initial.events[0]?.phase, 'proposal')
  assert.equal(initial.events[0]?.operationStatus, 'proposal')

  const beforeReadOnly = JSON.stringify(initial.events)
  manager.inspect(proposalId)
  manager.list()
  await manager.inspectLive(proposalId)
  const mismatch = await manager.confirm(proposalId, '0'.repeat(64))
  assert.equal(mismatch.status, 'awaiting-confirmation')
  assert.equal(JSON.stringify(manager.history({ proposalId }).events), beforeReadOnly)

  const confirmed = await manager.confirm(proposalId, pending.proposal?.confirmationDigest ?? '')
  const patchDraft = await manager.preparePatch({ proposalId, patchText: validPatch() })
  const applied = await manager.confirmPatch(patchDraft.proposal?.patch?.patchId ?? '', patchDraft.proposal?.patch?.confirmationDigest ?? '')
  const verified = await manager.verifyPatch({
    patchId: applied.proposal?.patch?.patchId ?? '',
    confirmationDigest: applied.proposal?.patch?.confirmationDigest ?? '',
    recipeId: 'history-verification',
  }, passedVerificationRunner())
  const commitDraft = await manager.prepareCommit({ proposalId, commitMessage: 'feat: history' })
  const created = await manager.confirmCommit(
    commitDraft.proposal?.commit?.commitId ?? '',
    commitDraft.proposal?.commit?.confirmationDigest ?? '',
    { authorize: async () => ({ allowed: true, auditId: 'history-approval', reason: 'approved' }) },
  )
  const landingDraft = await manager.prepareLanding({ proposalId })
  await manager.confirmLanding(
    landingDraft.proposal?.landing?.landingId ?? '',
    landingDraft.proposal?.landing?.confirmationDigest ?? '',
    { authorize: async () => ({ allowed: true, auditId: 'history-landing-approval', reason: 'approved' }) },
  )
  const released = await manager.release(proposalId)
  assert.equal(confirmed.operationStatus, 'worktree-created')
  assert.equal(verified.operationStatus, 'patch-verification-passed')
  assert.equal(created.operationStatus, 'commit-created')
  assert.equal(released.operationStatus, 'released')

  const history = manager.history({ proposalId, limit: 100 })
  assert.equal(history.status, 'available')
  assert.deepEqual(history.events.map((event) => event.operationStatus), [
    'proposal',
    'worktree-created',
    'patch-awaiting-confirmation',
    'patch-applied',
    'patch-verification-passed',
    'commit-awaiting-confirmation',
    'commit-created',
    'landing-awaiting-confirmation',
    'landing-completed',
    'released',
  ])
  assert.deepEqual(history.events.map((event) => event.phase), [
    'proposal', 'proposal', 'patch', 'patch', 'verification', 'commit', 'commit', 'landing', 'landing', 'release',
  ])
  assert.equal(JSON.stringify(history.events).includes('confirmationDigest'), false)
  assert.equal(JSON.stringify(history.events).includes('src/index.ts'), false)
})

test('lifecycle history is bounded, fail-closed, redacted, and detached', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter, limits: { maxHistoryEvents: 2 } })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request({ intent: 'token = "sk-abcdefghijklmnop"' }))
  const proposalId = pending.proposal?.proposalId ?? ''
  const invalidLimits = [0, -1, 1.5, 101, Number.NaN]
  for (const limit of invalidLimits) {
    const invalid = manager.history({ proposalId, limit })
    assert.equal(invalid.status, 'blocked')
    assert.deepEqual(invalid.events, [])
    assert.equal(invalid.total, 0)
  }
  const unknown = manager.history({ proposalId: 'proposal-unknown' })
  assert.equal(unknown.status, 'blocked')
  assert.deepEqual(unknown.events, [])
  assert.equal(adapter.inspectCount, 0)
  assert.equal(adapter.inspectSourceCount, 0)

  await manager.confirm(proposalId, pending.proposal?.confirmationDigest ?? '')
  const released = await manager.release(proposalId)
  assert.equal(released.status, 'released')
  const limited = manager.history({ proposalId, limit: 1 })
  assert.equal(limited.total, 2)
  assert.equal(limited.returned, 1)
  assert.equal(limited.truncated, true)
  assert.equal(limited.events[0]?.operationStatus, 'released')
  if (!limited.events[0]) throw new Error('history should contain the latest event')
  limited.events[0].reason = 'caller mutation'
  limited.events[0].executionStatus.push = 'push-not-performed'
  const detached = manager.history({ proposalId, limit: 1 })
  assert.notEqual(detached.events[0]?.reason, 'caller mutation')
  assert.equal(detached.events[0]?.executionStatus.push, 'push-not-performed')
  assert.equal(JSON.stringify(detached.events).includes('sk-abcdefghijklmnop'), false)
})

test('recovery guidance maps lifecycle stages without executing or recording recovery', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const proposalId = pending.proposal?.proposalId ?? ''

  const pendingGuidance = manager.inspectRecovery(proposalId)
  assert.equal(pendingGuidance.status, 'available')
  assert.equal(pendingGuidance.guidance?.recommendation, 'confirm')
  assert.deepEqual(pendingGuidance.guidance?.allowedActions, ['confirm', 'reject'])
  assert.equal(pendingGuidance.guidance?.manualReviewRequired, false)
  const historyCount = manager.history({ proposalId }).total
  const inspectCount = adapter.inspectCount + adapter.inspectSourceCount
  const confirmed = await manager.confirm(proposalId, pending.proposal?.confirmationDigest ?? '')

  const noPatch = manager.inspectRecovery(proposalId)
  assert.equal(noPatch.guidance?.recommendation, 'prepare-patch')
  assert.deepEqual(noPatch.guidance?.allowedActions, ['prepare-patch', 'release'])
  assert.equal(manager.history({ proposalId }).total, historyCount + 1)
  assert.equal(adapter.inspectCount + adapter.inspectSourceCount, inspectCount)

  const patchDraft = await manager.preparePatch({ proposalId, patchText: validPatch() })
  const patchPending = manager.inspectRecovery(proposalId)
  assert.equal(patchPending.guidance?.recommendation, 'confirm-patch')
  assert.deepEqual(patchPending.guidance?.allowedActions, ['confirm-patch', 'reject-patch', 'release'])
  const applied = await manager.confirmPatch(patchDraft.proposal?.patch?.patchId ?? '', patchDraft.proposal?.patch?.confirmationDigest ?? '')
  const patchApplied = manager.inspectRecovery(proposalId)
  assert.equal(patchApplied.guidance?.recommendation, 'verify-patch')
  assert.deepEqual(patchApplied.guidance?.allowedActions, ['verify-patch'])

  const verified = await manager.verifyPatch({
    patchId: applied.proposal?.patch?.patchId ?? '',
    confirmationDigest: applied.proposal?.patch?.confirmationDigest ?? '',
    recipeId: 'recovery-guidance',
  }, passedVerificationRunner())
  const verifiedGuidance = manager.inspectRecovery(proposalId)
  assert.equal(verifiedGuidance.guidance?.recommendation, 'prepare-commit')
  assert.deepEqual(verifiedGuidance.guidance?.allowedActions, ['prepare-commit'])

  const commitDraft = await manager.prepareCommit({ proposalId, commitMessage: 'feat: recovery guidance' })
  const commitPending = manager.inspectRecovery(proposalId)
  assert.equal(commitPending.guidance?.recommendation, 'confirm-commit')
  assert.deepEqual(commitPending.guidance?.allowedActions, ['confirm-commit', 'reject-commit'])
  const created = await manager.confirmCommit(
    commitDraft.proposal?.commit?.commitId ?? '',
    commitDraft.proposal?.commit?.confirmationDigest ?? '',
    { authorize: async () => ({ allowed: true, auditId: 'recovery-guidance-approval', reason: 'approved' }) },
  )
  const commitCreated = manager.inspectRecovery(proposalId)
  assert.equal(commitCreated.guidance?.recommendation, 'prepare-landing')
  assert.deepEqual(commitCreated.guidance?.allowedActions, ['prepare-landing', 'release'])

  const landingDraft = await manager.prepareLanding({ proposalId })
  const landingPending = manager.inspectRecovery(proposalId)
  assert.equal(landingPending.guidance?.recommendation, 'confirm-landing')
  assert.deepEqual(landingPending.guidance?.allowedActions, ['confirm-landing', 'reject-landing'])
  await manager.confirmLanding(
    landingDraft.proposal?.landing?.landingId ?? '',
    landingDraft.proposal?.landing?.confirmationDigest ?? '',
    { authorize: async () => ({ allowed: true, auditId: 'recovery-guidance-landing-approval', reason: 'approved' }) },
  )
  const landed = manager.inspectRecovery(proposalId)
  assert.equal(landed.guidance?.recommendation, 'release')
  assert.deepEqual(landed.guidance?.allowedActions, ['release'])
  const released = await manager.release(proposalId)
  assert.equal(released.status, 'released')
  const terminal = manager.inspectRecovery(proposalId)
  assert.equal(terminal.guidance?.recommendation, 'no-action')
  assert.deepEqual(terminal.guidance?.allowedActions, [])
  assert.equal(terminal.guidance?.manualReviewRequired, false)

  if (!terminal.guidance) throw new Error('terminal guidance should be available')
  terminal.guidance.allowedActions = ['confirm']
  terminal.guidance.proposal.intent = 'caller mutation'
  const detached = manager.inspectRecovery(proposalId)
  assert.deepEqual(detached.guidance?.allowedActions, [])
  assert.notEqual(detached.guidance?.proposal.intent, 'caller mutation')
  assert.equal(created.operationStatus, 'commit-created')
  assert.equal(verified.operationStatus, 'patch-verification-passed')
  assert.equal(manager.history({ proposalId }).total > historyCount, true)
})

test('recovery guidance is fail-safe for rejected, blocked, interrupted, and uncertain states', async () => {
  const rejectedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: new FakeGitAdapter() })
  rejectedManager.registerSession(createSession())
  const rejectedPending = await rejectedManager.prepare(request())
  const rejectedId = rejectedPending.proposal?.proposalId ?? ''
  rejectedManager.reject(rejectedId)
  const rejected = rejectedManager.inspectRecovery(rejectedId)
  assert.equal(rejected.guidance?.recommendation, 'no-action')
  assert.equal(rejected.guidance?.manualReviewRequired, false)

  const blockedAdapter = new FakeGitAdapter()
  const blockedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: blockedAdapter })
  blockedManager.registerSession(createSession())
  const blockedPending = await blockedManager.prepare(request())
  const blockedId = blockedPending.proposal?.proposalId ?? ''
  blockedAdapter.failDiscovery = true
  await blockedManager.confirm(blockedId, blockedPending.proposal?.confirmationDigest ?? '')
  const blocked = blockedManager.inspectRecovery(blockedId)
  assert.equal(blocked.guidance?.recommendation, 'manual-review-required')
  assert.deepEqual(blocked.guidance?.allowedActions, [])
  assert.equal(blocked.guidance?.manualReviewRequired, true)

  const interruptedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: new FakeGitAdapter() })
  interruptedManager.registerSession(createSession())
  const interruptedPending = await interruptedManager.prepare(request())
  const interruptedController = new AbortController()
  interruptedController.abort()
  await interruptedManager.confirm(interruptedPending.proposal?.proposalId ?? '', interruptedPending.proposal?.confirmationDigest ?? '', interruptedController.signal)
  const interrupted = interruptedManager.inspectRecovery(interruptedPending.proposal?.proposalId ?? '')
  assert.equal(interrupted.guidance?.recommendation, 'manual-review-required')
  assert.deepEqual(interrupted.guidance?.allowedActions, [])

  const uncertainAdapter = new FakeGitAdapter()
  const uncertainManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: uncertainAdapter })
  uncertainManager.registerSession(createSession())
  const uncertainDraft = await prepareVerifiedCommitDraft(uncertainManager, passedVerificationRunner(), 'recovery-uncertain')
  uncertainAdapter.failCommitPostcondition = true
  await uncertainManager.confirmCommit(
    uncertainDraft.proposal?.commit?.commitId ?? '',
    uncertainDraft.proposal?.commit?.confirmationDigest ?? '',
    { authorize: async () => ({ allowed: true, auditId: 'recovery-uncertain-approval', reason: 'approved' }) },
  )
  const uncertainBefore = uncertainManager.history({ proposalId: uncertainDraft.proposal?.proposalId ?? '' }).total
  const uncertain = uncertainManager.inspectRecovery(uncertainDraft.proposal?.proposalId ?? '')
  assert.equal(uncertain.guidance?.recommendation, 'manual-review-required')
  assert.deepEqual(uncertain.guidance?.allowedActions, [])
  assert.equal(uncertain.guidance?.manualReviewRequired, true)
  assert.equal(uncertainManager.history({ proposalId: uncertainDraft.proposal?.proposalId ?? '' }).total, uncertainBefore)

  const unknown = uncertainManager.inspectRecovery('proposal-unknown')
  assert.equal(unknown.status, 'blocked')
  assert.equal(unknown.guidance, undefined)
})

test('live inspection reports source and worktree observations without lifecycle mutation', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const proposalId = pending.proposal?.proposalId ?? ''
  const pendingOperation = pending.proposal?.operationStatus

  const sourceOnly = await manager.inspectLive(proposalId)
  assert.equal(sourceOnly.liveInspection?.status, 'available')
  assert.equal(sourceOnly.liveInspection?.source.status, 'available')
  assert.equal(sourceOnly.liveInspection?.source.baseRevisionMatches, true)
  assert.equal(sourceOnly.liveInspection?.source.repositoryRootMatches, true)
  assert.equal(sourceOnly.liveInspection?.source.workspacePathMatches, true)
  assert.equal(sourceOnly.liveInspection?.worktree.status, 'not-applicable')
  assert.equal(sourceOnly.proposal?.operationStatus, pendingOperation)
  assert.equal(adapter.inspectCount, 0)
  assert.equal(adapter.inspectSourceCount, 1)

  const confirmed = await manager.confirm(proposalId, pending.proposal?.confirmationDigest ?? '')
  const confirmedLive = await manager.inspectLive(proposalId)
  assert.equal(confirmedLive.liveInspection?.status, 'available')
  assert.equal(confirmedLive.liveInspection?.worktree.status, 'available')
  assert.equal(confirmedLive.liveInspection?.worktree.clean, true)
  assert.equal(confirmedLive.liveInspection?.worktree.baseRevisionMatches, true)
  assert.equal(confirmedLive.liveInspection?.worktree.identityMatches, true)
  assert.equal(confirmedLive.liveInspection?.worktree.changedPathCount, 0)
  assert.equal(confirmedLive.proposal?.operationStatus, confirmed.proposal?.operationStatus)
  adapter.dirty = true
  const dirty = await manager.inspectLive(proposalId)
  assert.equal(dirty.liveInspection?.worktree.clean, false)
  assert.equal(dirty.proposal?.status, 'confirmed')
})

test('live inspection distinguishes partial, unknown, abort, and unknown proposal states', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const patchDraft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  await manager.confirmPatch(patchDraft.proposal?.patch?.patchId ?? '', patchDraft.proposal?.patch?.confirmationDigest ?? '')
  adapter.failPostcondition = true
  const before = manager.inspect(pending.proposal?.proposalId ?? '')
  const partial = await manager.inspectLive(pending.proposal?.proposalId ?? '')
  assert.equal(partial.liveInspection?.status, 'partial')
  assert.equal(partial.liveInspection?.source.status, 'available')
  assert.equal(partial.liveInspection?.worktree.status, 'unknown')
  assert.equal(partial.proposal?.operationStatus, before.operationStatus)

  adapter.failSourceInspection = true
  const unknown = await manager.inspectLive(pending.proposal?.proposalId ?? '')
  assert.equal(unknown.liveInspection?.status, 'unknown')
  assert.equal(unknown.liveInspection?.source.status, 'unknown')
  assert.equal(unknown.liveInspection?.worktree.status, 'unknown')
  assert.equal(JSON.stringify(unknown.liveInspection).includes('src/index.ts'), false)

  const controller = new AbortController()
  controller.abort()
  const interrupted = await manager.inspectLive(pending.proposal?.proposalId ?? '', controller.signal)
  assert.equal(interrupted.liveInspection?.status, 'unknown')
  assert.equal(interrupted.liveInspection?.source.status, 'unknown')
  assert.equal(adapter.inspectSourceCount >= 2, true)

  const beforeCalls = adapter.inspectSourceCount + adapter.inspectCount
  const missing = await manager.inspectLive('proposal-unknown')
  assert.equal(missing.status, 'blocked')
  assert.equal(missing.liveInspection, undefined)
  assert.equal(adapter.inspectSourceCount + adapter.inspectCount, beforeCalls)
})

test('landing preflight reports local relations without landing or lifecycle mutation', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const proposalId = pending.proposal?.proposalId ?? ''

  const notApplicable = await manager.inspectLanding(proposalId)
  assert.equal(notApplicable.landingAssessment?.status, 'not-applicable')
  assert.equal(notApplicable.landingAssessment?.relation, 'not-applicable')
  assert.equal(adapter.inspectLandingCount, 0)

  const created = await prepareCreatedCommit(manager, passedVerificationRunner(), 'landing-preflight')
  const createdId = created.proposal?.proposalId ?? ''
  const beforeHistory = manager.history({ proposalId: createdId }).total
  const fastForwardable = await manager.inspectLanding(createdId)
  assert.equal(fastForwardable.landingAssessment?.status, 'available')
  assert.equal(fastForwardable.landingAssessment?.relation, 'fast-forwardable')
  assert.equal(fastForwardable.landingAssessment?.clean, true)
  assert.equal(fastForwardable.landingAssessment?.baseRevisionMatches, true)
  assert.equal(fastForwardable.landingAssessment?.sourceRevision, fakeBaseRevision)
  assert.equal(fastForwardable.landingAssessment?.targetRevision, adapter.commitRevision)
  assert.equal(JSON.stringify(fastForwardable.landingAssessment).includes(fixtureRoot), false)
  assert.equal(adapter.landCount, 0)
  assert.equal(adapter.removeCount, 0)

  const detached = fastForwardable.landingAssessment
  if (!detached) throw new Error('landing assessment should be present')
  detached.relation = 'diverged'
  const repeated = await manager.inspectLanding(createdId)
  assert.equal(repeated.landingAssessment?.relation, 'fast-forwardable')
  assert.equal(manager.history({ proposalId: createdId }).total, beforeHistory)

  adapter.sourceRevision = adapter.commitRevision
  adapter.landingSourceIsAncestor = false
  adapter.landingTargetIsAncestor = true
  const alreadyLanded = await manager.inspectLanding(createdId)
  assert.equal(alreadyLanded.landingAssessment?.relation, 'already-landed')

  adapter.sourceRevision = 'c'.repeat(40)
  const sourceAhead = await manager.inspectLanding(createdId)
  assert.equal(sourceAhead.landingAssessment?.relation, 'source-ahead')
  assert.equal(sourceAhead.landingAssessment?.baseRevisionMatches, false)

  adapter.landingTargetIsAncestor = false
  const drifted = await manager.inspectLanding(createdId)
  assert.equal(drifted.landingAssessment?.relation, 'source-revision-drift')

  adapter.sourceRevision = fakeBaseRevision
  adapter.landingSourceIsAncestor = false
  const diverged = await manager.inspectLanding(createdId)
  assert.equal(diverged.landingAssessment?.relation, 'diverged')

  adapter.sourceDirty = true
  const dirty = await manager.inspectLanding(createdId)
  assert.equal(dirty.landingAssessment?.relation, 'source-dirty')
  adapter.sourceDirty = false

  adapter.failLandingTarget = true
  const targetUnavailable = await manager.inspectLanding(createdId)
  assert.equal(targetUnavailable.landingAssessment?.status, 'unknown')
  assert.equal(targetUnavailable.landingAssessment?.relation, 'target-unavailable')
  adapter.failLandingTarget = false
  adapter.failLandingInspection = true
  const unknown = await manager.inspectLanding(createdId)
  assert.equal(unknown.landingAssessment?.status, 'unknown')
  assert.equal(unknown.landingAssessment?.relation, 'unknown')
  adapter.failLandingInspection = false

  const controller = new AbortController()
  controller.abort()
  const beforeAbortCalls = adapter.inspectLandingCount
  const interrupted = await manager.inspectLanding(createdId, controller.signal)
  assert.equal(interrupted.landingAssessment?.status, 'unknown')
  assert.equal(interrupted.landingAssessment?.relation, 'unknown')
  assert.equal(adapter.inspectLandingCount, beforeAbortCalls)

  const missing = await manager.inspectLanding('proposal-unknown')
  assert.equal(missing.status, 'blocked')
  assert.equal(missing.landingAssessment, undefined)
})

test('release readiness reports bounded worktree facts without release or lifecycle mutation', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const proposalId = pending.proposal?.proposalId ?? ''

  const notApplicable = await manager.inspectRelease(proposalId)
  assert.equal(notApplicable.releaseAssessment?.status, 'not-applicable')
  assert.equal(notApplicable.releaseAssessment?.relation, 'not-applicable')
  assert.equal(adapter.inspectCount, 0)

  const missing = await manager.inspectRelease('proposal-unknown')
  assert.equal(missing.status, 'blocked')
  assert.equal(missing.releaseAssessment, undefined)
  assert.equal(adapter.inspectCount, 0)

  const confirmed = await manager.confirm(proposalId, pending.proposal?.confirmationDigest ?? '')
  const beforeHistory = manager.history({ proposalId }).total
  const ready = await manager.inspectRelease(proposalId)
  assert.equal(ready.status, 'confirmed')
  assert.equal(ready.releaseAssessment?.status, 'available')
  assert.equal(ready.releaseAssessment?.relation, 'ready')
  assert.equal(ready.releaseAssessment?.clean, true)
  assert.equal(ready.releaseAssessment?.identityMatches, true)
  assert.match(ready.releaseAssessment?.reason ?? '', /release was not performed/)
  assert.equal(JSON.stringify(ready.releaseAssessment).includes(fixtureRoot), false)
  assert.equal(adapter.inspectCount, 1)
  assert.equal(adapter.removeCount, 0)
  assert.equal(adapter.landCount, 0)
  assert.equal(adapter.inspectSourceCount, 0)

  if (!ready.releaseAssessment) throw new Error('release assessment should be present')
  ready.releaseAssessment.relation = 'worktree-dirty'
  const repeated = await manager.inspectRelease(proposalId)
  assert.equal(repeated.releaseAssessment?.relation, 'ready')
  assert.equal(manager.history({ proposalId }).total, beforeHistory)

  adapter.dirty = true
  const dirty = await manager.inspectRelease(proposalId)
  assert.equal(dirty.releaseAssessment?.relation, 'worktree-dirty')
  assert.equal(dirty.releaseAssessment?.clean, false)
  assert.equal(dirty.releaseAssessment?.identityMatches, true)
  adapter.dirty = false

  adapter.identityMismatch = true
  const mismatched = await manager.inspectRelease(proposalId)
  assert.equal(mismatched.releaseAssessment?.relation, 'identity-mismatch')
  assert.equal(mismatched.releaseAssessment?.identityMatches, false)
  adapter.identityMismatch = false

  const released = await manager.release(proposalId)
  assert.equal(released.status, 'released')
  assert.equal(adapter.inspectCount, 5)
  const beforeBlockedInspect = adapter.inspectCount
  const blockedState = await manager.inspectRelease(proposalId)
  assert.equal(blockedState.releaseAssessment?.status, 'available')
  assert.equal(blockedState.releaseAssessment?.relation, 'proposal-state-blocked')
  assert.equal(adapter.inspectCount, beforeBlockedInspect)
  assert.equal(adapter.removeCount, 1)

  const failedAdapter = new FakeGitAdapter()
  const failedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: failedAdapter })
  failedManager.registerSession(createSession())
  const failedPending = await failedManager.prepare(request())
  const failedId = failedPending.proposal?.proposalId ?? ''
  await failedManager.confirm(failedId, failedPending.proposal?.confirmationDigest ?? '')
  failedAdapter.failWorktreeInspection = true
  const beforeFailedHistory = failedManager.history({ proposalId: failedId }).total
  const failed = await failedManager.inspectRelease(failedId)
  assert.equal(failed.releaseAssessment?.status, 'unknown')
  assert.equal(failed.releaseAssessment?.relation, 'unknown')
  assert.equal(failedManager.history({ proposalId: failedId }).total, beforeFailedHistory)
  assert.equal(failedAdapter.removeCount, 0)

  const abortedAdapter = new FakeGitAdapter()
  const abortedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: abortedAdapter })
  abortedManager.registerSession(createSession())
  const abortedPending = await abortedManager.prepare(request())
  const abortedId = abortedPending.proposal?.proposalId ?? ''
  await abortedManager.confirm(abortedId, abortedPending.proposal?.confirmationDigest ?? '')
  const controller = new AbortController()
  controller.abort()
  const beforeAbortInspect = abortedAdapter.inspectCount
  const interrupted = await abortedManager.inspectRelease(abortedId, controller.signal)
  assert.equal(interrupted.releaseAssessment?.status, 'unknown')
  assert.equal(interrupted.releaseAssessment?.relation, 'unknown')
  assert.equal(abortedAdapter.inspectCount, beforeAbortInspect)
  assert.equal(abortedAdapter.removeCount, 0)
})

test('proposal validation preserves safe partial targets and bounded evidence', async () => {
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), {
    adapter: new FakeGitAdapter(),
    limits: { maxTargets: 4, maxEvidenceIds: 1, maxTextBytes: 512 },
  })
  manager.registerSession(createSession(['src']))
  const result = await manager.prepare(request({
    intent: '变更'.repeat(400),
    targets: [
      { relativePath: 'src/index.ts', operation: 'modify' },
      { relativePath: '../outside.ts', operation: 'modify' },
      { relativePath: '.env', operation: 'modify' },
      { relativePath: 'README.md', operation: 'modify' },
      { relativePath: 'src/server.ts', operation: 'modify' },
    ],
    evidenceIds: ['missing', 'also-missing'],
  }))
  assert.equal(result.status, 'awaiting-confirmation')
  assert.equal(result.proposal?.targets.filter((target) => target.status === 'confirmed').length, 1)
  assert.ok(result.proposal?.targets.some((target) => target.reason?.includes('outside')))
  assert.ok(result.proposal?.targets.some((target) => target.reason?.includes('outside the confirmed GoalSpec scope')))
  assert.ok(result.proposal?.targets.some((target) => target.reason?.includes('sensitive path')))
  assert.ok(result.proposal?.limitations.some((item) => item.includes('budget exhausted')))
  assert.ok(result.proposal?.limitations.some((item) => item.includes('evidence id')))
  assert.ok((result.proposal?.intent.length ?? 0) <= 512)

  const sensitiveManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: new FakeGitAdapter() })
  sensitiveManager.registerSession(createSession(['.']))
  const sensitive = await sensitiveManager.prepare(request({ targets: [{ relativePath: '.env', operation: 'modify' }] }))
  assert.equal(sensitive.status, 'blocked')
  assert.match(sensitive.reason, /sensitive|eligible/)
})

test('proposal fails closed for missing session, abort, Git failure, and dirty release', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  const missing = await manager.prepare(request({ sessionId: 'unknown' }))
  assert.equal(missing.status, 'blocked')

  const aborted = new AbortController()
  aborted.abort()
  const interrupted = await manager.prepare(request(), aborted.signal)
  assert.equal(interrupted.status, 'interrupted')

  adapter.failDiscovery = true
  manager.registerSession(createSession())
  const failed = await manager.prepare(request())
  assert.equal(failed.status, 'blocked')
  adapter.failDiscovery = false

  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  assert.equal(confirmed.status, 'confirmed')
  adapter.dirty = true
  const dirty = await manager.release(pending.proposal?.proposalId ?? '')
  assert.equal(dirty.status, 'blocked')
  assert.equal(adapter.removeCount, 0)
})

test('proposal confirmation expires and cannot be replayed after rejection', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter, limits: { expirationMs: 1 } })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  assert.ok(pending.proposal)
  await new Promise((resolve) => setTimeout(resolve, 5))
  const expired = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  assert.equal(expired.status, 'blocked')
  assert.equal(adapter.createCount, 0)

  const second = await manager.prepare(request())
  const rejected = manager.reject(second.proposal?.proposalId ?? '')
  assert.equal(rejected.status, 'rejected')
  const replay = await manager.confirm(second.proposal?.proposalId ?? '', second.proposal?.confirmationDigest ?? '')
  assert.equal(replay.status, 'rejected')
  assert.equal(adapter.createCount, 0)
})

test('patch lifecycle requires a second exact digest and retains applied dirty worktrees', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const draft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })

  assert.equal(draft.status, 'confirmed')
  assert.equal(draft.operationStatus, 'patch-awaiting-confirmation')
  assert.equal(draft.proposal?.patch?.status, 'awaiting-confirmation')
  assert.equal(adapter.applyPatchCount, 0)

  const mismatch = await manager.confirmPatch(draft.proposal?.patch?.patchId ?? '', '0'.repeat(64))
  assert.equal(mismatch.proposal?.patch?.status, 'awaiting-confirmation')
  assert.equal(adapter.applyPatchCount, 0)

  const applied = await manager.confirmPatch(draft.proposal?.patch?.patchId ?? '', draft.proposal?.patch?.confirmationDigest ?? '')
  assert.equal(applied.status, 'confirmed')
  assert.equal(applied.operationStatus, 'patch-applied')
  assert.equal(applied.proposal?.patch?.status, 'applied')
  assert.equal(applied.proposal?.patchApplied, true)
  assert.equal(applied.proposal?.executionStatus.patch, 'patch-applied')
  assert.equal(applied.proposal?.commitCreated, false)
  assert.equal(applied.proposal?.pushPerformed, false)
  assert.equal(adapter.applyPatchCount, 1)

  const replay = await manager.confirmPatch(draft.proposal?.patch?.patchId ?? '', draft.proposal?.patch?.confirmationDigest ?? '')
  assert.equal(replay.proposal?.patch?.status, 'applied')
  assert.equal(adapter.applyPatchCount, 1)

  const release = await manager.release(draft.proposal?.proposalId ?? '')
  assert.equal(release.status, 'blocked')
  assert.equal(adapter.removeCount, 0)
})

test('patch review and export require the exact digest without mutating the worktree', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const draft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch('exported') })
  const patchId = draft.proposal?.patch?.patchId ?? ''
  const digest = draft.proposal?.patch?.confirmationDigest ?? ''

  const reviewed = manager.reviewPatch(patchId)
  assert.equal(reviewed.proposal?.patch?.status, 'awaiting-confirmation')
  assert.equal(adapter.applyPatchCount, 0)

  const mismatch = manager.exportPatch(patchId, '0'.repeat(64))
  assert.equal(mismatch.patchExport, undefined)
  assert.equal(mismatch.proposal?.patch?.status, 'awaiting-confirmation')
  assert.equal(adapter.applyPatchCount, 0)

  const exported = manager.exportPatch(patchId, digest)
  assert.equal(exported.patchExport?.sessionOnly, true)
  assert.equal(exported.patchExport?.patchText, validPatch('exported'))
  assert.equal(exported.patchExport?.confirmationDigest, digest)
  assert.equal(exported.proposal?.patch?.status, 'awaiting-confirmation')
  assert.equal(exported.proposal?.executionStatus.patch, 'patch-not-applied')
  assert.equal(exported.proposal?.commitCreated, false)
  assert.equal(exported.proposal?.pushPerformed, false)
  assert.equal(adapter.applyPatchCount, 0)
})

test('patch verification is digest-bound, read-only at the manager boundary, and non-replayable', async () => {
  const adapter = new FakeGitAdapter()
  let runnerCalls = 0
  const runner: ChangeProposalVerificationRunner = {
    async run({ recipeId, worktree }): Promise<ChangeProposalVerification> {
      runnerCalls += 1
      return {
        verificationId: `verification-${runnerCalls}`,
        auditId: `audit-${runnerCalls}`,
        recipeId,
        status: 'passed',
        reason: 'verification completed successfully',
        worktreeIdentity: worktree.identity,
        stdout: 'ok',
        stderr: '',
        outputTruncated: false,
        redacted: false,
        redactedMatchCount: 0,
        exitCode: 0,
        signal: null,
        createdAt: new Date().toISOString(),
      }
    },
  }
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const draft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const applied = await manager.confirmPatch(draft.proposal?.patch?.patchId ?? '', draft.proposal?.patch?.confirmationDigest ?? '')
  const verifyRequest = {
    patchId: applied.proposal?.patch?.patchId ?? '',
    confirmationDigest: applied.proposal?.patch?.confirmationDigest ?? '',
    recipeId: 'test',
  }

  const mismatch = await manager.verifyPatch({ ...verifyRequest, confirmationDigest: '0'.repeat(64) }, runner)
  assert.equal(mismatch.proposal?.patch?.verificationStatus, 'not-run')
  assert.equal(runnerCalls, 0)

  const verified = await manager.verifyPatch(verifyRequest, runner)
  assert.equal(verified.operationStatus, 'patch-verification-passed')
  assert.equal(verified.proposal?.patch?.verificationStatus, 'passed')
  assert.equal(verified.proposal?.executionStatus.patch, 'patch-applied')
  assert.equal(verified.proposal?.commitCreated, false)
  assert.equal(verified.proposal?.pushPerformed, false)
  assert.equal(verified.verification?.stdout, 'ok')
  assert.equal(runnerCalls, 1)

  const replay = await manager.verifyPatch(verifyRequest, runner)
  assert.equal(replay.operationStatus, 'patch-verification-passed')
  assert.equal(runnerCalls, 1)
})

test('isolated commit lifecycle requires passed verification, exact digest, approval, and clean postcondition', async () => {
  const adapter = new FakeGitAdapter()
  let verificationCalls = 0
  const runner: ChangeProposalVerificationRunner = {
    async run({ recipeId, worktree }): Promise<ChangeProposalVerification> {
      verificationCalls += 1
      return {
        verificationId: `verification-commit-${verificationCalls}`,
        auditId: `audit-commit-${verificationCalls}`,
        recipeId,
        status: 'passed',
        reason: 'verification passed',
        worktreeIdentity: worktree.identity,
        stdout: 'ok',
        stderr: '',
        outputTruncated: false,
        redacted: false,
        redactedMatchCount: 0,
        exitCode: 0,
        signal: null,
        createdAt: new Date().toISOString(),
      }
    },
  }
  const authorizer = {
    authorize: async () => ({ allowed: true, auditId: 'commit-approval-1', reason: 'approved' }),
  }
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const patchDraft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const applied = await manager.confirmPatch(patchDraft.proposal?.patch?.patchId ?? '', patchDraft.proposal?.patch?.confirmationDigest ?? '')
  const verified = await manager.verifyPatch({
    patchId: applied.proposal?.patch?.patchId ?? '',
    confirmationDigest: applied.proposal?.patch?.confirmationDigest ?? '',
    recipeId: 'commit-test',
  }, runner)
  const secretMessage = await manager.prepareCommit({ proposalId: verified.proposal?.proposalId ?? '', commitMessage: 'token=not-a-commit-message' })
  assert.equal(secretMessage.proposal?.commit, undefined)
  const oversizedMessage = await manager.prepareCommit({ proposalId: verified.proposal?.proposalId ?? '', commitMessage: 'x'.repeat(5_000) })
  assert.equal(oversizedMessage.proposal?.commit, undefined)
  const draft = await manager.prepareCommit({ proposalId: verified.proposal?.proposalId ?? '', commitMessage: 'feat: isolated change' })

  assert.equal(draft.proposal?.commit?.status, 'awaiting-confirmation')
  assert.equal(draft.proposal?.executionStatus.commit, 'commit-not-created')
  assert.equal(draft.commit?.confirmationDigest, draft.proposal?.commit?.confirmationDigest)
  assert.equal(adapter.commitCount, 0)

  const mismatch = await manager.confirmCommit(draft.proposal?.commit?.commitId ?? '', '0'.repeat(64), authorizer)
  assert.equal(mismatch.proposal?.commit?.status, 'awaiting-confirmation')
  assert.equal(adapter.commitCount, 0)

  const created = await manager.confirmCommit(
    draft.proposal?.commit?.commitId ?? '',
    draft.proposal?.commit?.confirmationDigest ?? '',
    authorizer,
    { callId: 'commit-call', agent: { session: { header: { cwd: fixtureRoot } } } },
  )
  assert.equal(created.status, 'confirmed')
  assert.equal(created.operationStatus, 'commit-created')
  assert.equal(created.proposal?.commit?.status, 'created')
  assert.equal(created.proposal?.commit?.executionStatus, 'commit-created')
  assert.equal(created.proposal?.commit?.approvalAuditId, 'commit-approval-1')
  assert.equal(created.proposal?.commit?.revision, adapter.commitRevision)
  assert.equal(created.proposal?.commitCreated, true)
  assert.equal(created.proposal?.executionStatus.commit, 'commit-created')
  assert.equal(created.proposal?.executionStatus.push, 'push-not-performed')
  assert.equal(adapter.commitCount, 1)

  const replay = await manager.confirmCommit(draft.proposal?.commit?.commitId ?? '', draft.proposal?.commit?.confirmationDigest ?? '', authorizer)
  assert.equal(replay.proposal?.commit?.status, 'created')
  assert.equal(adapter.commitCount, 1)
  const released = await manager.release(draft.proposal?.proposalId ?? '')
  assert.equal(released.status, 'released')
  assert.equal(adapter.removeCount, 1)
})

test('isolated commit blocks unverified, rejected, expired, failed, and uncertain states without cleanup', async () => {
  const unavailableAdapter = new FakeGitAdapter()
  const unavailableManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: unavailableAdapter })
  unavailableManager.registerSession(createSession())
  const unavailablePending = await unavailableManager.prepare(request())
  const unavailableConfirmed = await unavailableManager.confirm(unavailablePending.proposal?.proposalId ?? '', unavailablePending.proposal?.confirmationDigest ?? '')
  const unavailable = await unavailableManager.prepareCommit({ proposalId: unavailableConfirmed.proposal?.proposalId ?? '', commitMessage: 'feat: not verified' })
  assert.equal(unavailable.proposal?.commit, undefined)
  assert.match(unavailable.reason, /passed verification/)

  const runner: ChangeProposalVerificationRunner = {
    async run({ recipeId, worktree }): Promise<ChangeProposalVerification> {
      return {
        verificationId: 'verification-failure',
        auditId: 'audit-failure',
        recipeId,
        status: 'failed',
        reason: 'verification failed',
        worktreeIdentity: worktree.identity,
        stdout: '',
        stderr: 'failed',
        outputTruncated: false,
        redacted: false,
        redactedMatchCount: 0,
        createdAt: new Date().toISOString(),
      }
    },
  }
  const rejectedAdapter = new FakeGitAdapter()
  const rejectedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: rejectedAdapter })
  rejectedManager.registerSession(createSession())
  const rejectedPending = await rejectedManager.prepare(request())
  const rejectedConfirmed = await rejectedManager.confirm(rejectedPending.proposal?.proposalId ?? '', rejectedPending.proposal?.confirmationDigest ?? '')
  const rejectedPatch = await rejectedManager.preparePatch({ proposalId: rejectedConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const rejectedApplied = await rejectedManager.confirmPatch(rejectedPatch.proposal?.patch?.patchId ?? '', rejectedPatch.proposal?.patch?.confirmationDigest ?? '')
  const rejectedVerified = await rejectedManager.verifyPatch({ patchId: rejectedApplied.proposal?.patch?.patchId ?? '', confirmationDigest: rejectedApplied.proposal?.patch?.confirmationDigest ?? '', recipeId: 'failure' }, runner)
  assert.equal(rejectedVerified.proposal?.patch?.verificationStatus, 'failed')
  assert.equal((await rejectedManager.prepareCommit({ proposalId: rejectedVerified.proposal?.proposalId ?? '', commitMessage: 'feat: rejected' })).proposal?.commit, undefined)

  const happyRunner: ChangeProposalVerificationRunner = {
    async run({ recipeId, worktree }): Promise<ChangeProposalVerification> {
      return {
        verificationId: `verification-${recipeId}`,
        auditId: `audit-${recipeId}`,
        recipeId,
        status: 'passed',
        reason: 'verification passed',
        worktreeIdentity: worktree.identity,
        stdout: 'ok',
        stderr: '',
        outputTruncated: false,
        redacted: false,
        redactedMatchCount: 0,
        exitCode: 0,
        signal: null,
        createdAt: new Date().toISOString(),
      }
    },
  }
  const abortedAdapter = new FakeGitAdapter()
  const abortedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: abortedAdapter })
  abortedManager.registerSession(createSession())
  const abortedDraft = await prepareVerifiedCommitDraft(abortedManager, happyRunner, 'aborted')
  const abortedController = new AbortController()
  abortedController.abort()
  const interrupted = await abortedManager.confirmCommit(abortedDraft.proposal?.commit?.commitId ?? '', abortedDraft.proposal?.commit?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) }, undefined, abortedController.signal)
  assert.equal(interrupted.proposal?.commit?.status, 'interrupted')
  assert.equal(interrupted.proposal?.commit?.executionStatus, 'commit-not-created')
  assert.equal(abortedAdapter.commitCount, 0)

  const expiringAdapter = new FakeGitAdapter()
  const expiringManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: expiringAdapter, limits: { expirationMs: 25 } })
  expiringManager.registerSession(createSession())
  const expiringDraft = await prepareVerifiedCommitDraft(expiringManager, happyRunner, 'expired')
  await new Promise((resolve) => setTimeout(resolve, 40))
  const expired = await expiringManager.confirmCommit(expiringDraft.proposal?.commit?.commitId ?? '', expiringDraft.proposal?.commit?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) })
  assert.equal(expired.proposal?.commit?.status, 'blocked')
  assert.equal(expired.proposal?.commit?.executionStatus, 'commit-not-created')
  assert.equal(expiringAdapter.commitCount, 0)

  const deniedAdapter = new FakeGitAdapter()
  const deniedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: deniedAdapter })
  deniedManager.registerSession(createSession())
  const deniedPending = await deniedManager.prepare(request())
  const deniedConfirmed = await deniedManager.confirm(deniedPending.proposal?.proposalId ?? '', deniedPending.proposal?.confirmationDigest ?? '')
  const deniedPatch = await deniedManager.preparePatch({ proposalId: deniedConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const deniedApplied = await deniedManager.confirmPatch(deniedPatch.proposal?.patch?.patchId ?? '', deniedPatch.proposal?.patch?.confirmationDigest ?? '')
  const deniedVerified = await deniedManager.verifyPatch({ patchId: deniedApplied.proposal?.patch?.patchId ?? '', confirmationDigest: deniedApplied.proposal?.patch?.confirmationDigest ?? '', recipeId: 'denied' }, happyRunner)
  const deniedDraft = await deniedManager.prepareCommit({ proposalId: deniedVerified.proposal?.proposalId ?? '', commitMessage: 'feat: denied approval' })
  const denied = await deniedManager.confirmCommit(deniedDraft.proposal?.commit?.commitId ?? '', deniedDraft.proposal?.commit?.confirmationDigest ?? '', { authorize: async () => ({ allowed: false, reason: 'user rejected' }) })
  assert.equal(denied.proposal?.commit?.status, 'awaiting-confirmation')
  assert.equal(deniedAdapter.commitCount, 0)
  const rejected = deniedManager.rejectCommit(deniedDraft.proposal?.commit?.commitId ?? '')
  assert.equal(rejected.proposal?.commit?.status, 'rejected')
  const rejectedReplay = await deniedManager.confirmCommit(deniedDraft.proposal?.commit?.commitId ?? '', deniedDraft.proposal?.commit?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) })
  assert.equal(rejectedReplay.proposal?.commit?.status, 'rejected')
  assert.equal(deniedAdapter.commitCount, 0)

  const failingAdapter = new FakeGitAdapter()
  failingAdapter.failCommit = true
  const failingManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: failingAdapter })
  failingManager.registerSession(createSession())
  const failingPending = await failingManager.prepare(request())
  const failingConfirmed = await failingManager.confirm(failingPending.proposal?.proposalId ?? '', failingPending.proposal?.confirmationDigest ?? '')
  const failingPatch = await failingManager.preparePatch({ proposalId: failingConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const failingApplied = await failingManager.confirmPatch(failingPatch.proposal?.patch?.patchId ?? '', failingPatch.proposal?.patch?.confirmationDigest ?? '')
  const failingVerified = await failingManager.verifyPatch({ patchId: failingApplied.proposal?.patch?.patchId ?? '', confirmationDigest: failingApplied.proposal?.patch?.confirmationDigest ?? '', recipeId: 'failing' }, happyRunner)
  const failingDraft = await failingManager.prepareCommit({ proposalId: failingVerified.proposal?.proposalId ?? '', commitMessage: 'feat: failing commit' })
  const failed = await failingManager.confirmCommit(failingDraft.proposal?.commit?.commitId ?? '', failingDraft.proposal?.commit?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'approval-fail', reason: 'approved' }) })
  assert.equal(failed.proposal?.commit?.status, 'blocked')
  assert.equal(failed.proposal?.commit?.executionStatus, 'commit-not-created')
  assert.equal((await failingManager.release(failingDraft.proposal?.proposalId ?? '')).status, 'blocked')
  assert.equal(failingAdapter.removeCount, 0)

  const uncertainAdapter = new FakeGitAdapter()
  uncertainAdapter.failCommitPostcondition = true
  const uncertainManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: uncertainAdapter })
  uncertainManager.registerSession(createSession())
  const uncertainPending = await uncertainManager.prepare(request())
  const uncertainConfirmed = await uncertainManager.confirm(uncertainPending.proposal?.proposalId ?? '', uncertainPending.proposal?.confirmationDigest ?? '')
  const uncertainPatch = await uncertainManager.preparePatch({ proposalId: uncertainConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const uncertainApplied = await uncertainManager.confirmPatch(uncertainPatch.proposal?.patch?.patchId ?? '', uncertainPatch.proposal?.patch?.confirmationDigest ?? '')
  const uncertainVerified = await uncertainManager.verifyPatch({ patchId: uncertainApplied.proposal?.patch?.patchId ?? '', confirmationDigest: uncertainApplied.proposal?.patch?.confirmationDigest ?? '', recipeId: 'uncertain' }, happyRunner)
  const uncertainDraft = await uncertainManager.prepareCommit({ proposalId: uncertainVerified.proposal?.proposalId ?? '', commitMessage: 'feat: uncertain commit' })
  const uncertain = await uncertainManager.confirmCommit(uncertainDraft.proposal?.commit?.commitId ?? '', uncertainDraft.proposal?.commit?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'approval-uncertain', reason: 'approved' }) })
  assert.equal(uncertain.proposal?.commit?.status, 'blocked')
  assert.equal(uncertain.proposal?.commit?.executionStatus, 'commit-creation-unknown')
  assert.equal(uncertainAdapter.removeCount, 0)
})

test('source landing requires exact base and approval, then fast-forwards once', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const created = await prepareCreatedCommit(manager, passedVerificationRunner(), 'landing-happy')
  const draft = await manager.prepareLanding({ proposalId: created.proposal?.proposalId ?? '' })
  assert.equal(draft.status, 'confirmed')
  assert.equal(draft.operationStatus, 'landing-awaiting-confirmation')
  assert.equal(draft.proposal?.landing?.status, 'awaiting-confirmation')
  assert.equal(draft.proposal?.sourceLanded, false)
  assert.equal(adapter.landCount, 0)

  const mismatch = await manager.confirmLanding(draft.proposal?.landing?.landingId ?? '', '0'.repeat(64), { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) })
  assert.equal(mismatch.proposal?.landing?.status, 'awaiting-confirmation')
  assert.equal(adapter.landCount, 0)

  const denied = await manager.confirmLanding(draft.proposal?.landing?.landingId ?? '', draft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: false, reason: 'user rejected' }) })
  assert.equal(denied.proposal?.landing?.status, 'awaiting-confirmation')
  assert.equal(adapter.landCount, 0)

  const landed = await manager.confirmLanding(draft.proposal?.landing?.landingId ?? '', draft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'landing-approval-1', reason: 'approved' }) })
  assert.equal(landed.status, 'confirmed')
  assert.equal(landed.operationStatus, 'landing-completed')
  assert.equal(landed.proposal?.landing?.status, 'landed')
  assert.equal(landed.proposal?.landing?.executionStatus, 'landing-completed')
  assert.equal(landed.proposal?.landing?.landedRevision, adapter.commitRevision)
  assert.equal(landed.proposal?.landing?.approvalAuditId, 'landing-approval-1')
  assert.equal(landed.proposal?.sourceLanded, true)
  assert.equal(landed.proposal?.executionStatus.landing, 'landing-completed')
  assert.equal(landed.proposal?.executionStatus.push, 'push-not-performed')
  assert.equal(adapter.landCount, 1)

  const replay = await manager.confirmLanding(draft.proposal?.landing?.landingId ?? '', draft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) })
  assert.equal(replay.proposal?.landing?.status, 'landed')
  assert.equal(adapter.landCount, 1)
  assert.equal((await manager.release(draft.proposal?.proposalId ?? '')).status, 'released')
})

test('source landing fails closed for source drift, abort, expiry, Git failure, and unknown postcondition', async () => {
  const driftAdapter = new FakeGitAdapter()
  driftAdapter.sourceDirty = true
  const driftManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: driftAdapter })
  driftManager.registerSession(createSession())
  const driftCreated = await prepareCreatedCommit(driftManager, passedVerificationRunner(), 'landing-dirty')
  const dirty = await driftManager.prepareLanding({ proposalId: driftCreated.proposal?.proposalId ?? '' })
  assert.equal(dirty.proposal?.landing, undefined)
  assert.match(dirty.reason, /clean source/)
  assert.equal(driftAdapter.landCount, 0)

  const baseAdapter = new FakeGitAdapter()
  const baseManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: baseAdapter })
  baseManager.registerSession(createSession())
  const baseCreated = await prepareCreatedCommit(baseManager, passedVerificationRunner(), 'landing-drift')
  const baseDraft = await baseManager.prepareLanding({ proposalId: baseCreated.proposal?.proposalId ?? '' })
  baseAdapter.sourceRevision = 'different-base'
  const baseBlocked = await baseManager.confirmLanding(baseDraft.proposal?.landing?.landingId ?? '', baseDraft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) })
  assert.equal(baseBlocked.proposal?.landing?.status, 'blocked')
  assert.equal(baseBlocked.proposal?.landing?.executionStatus, 'landing-not-performed')
  assert.equal(baseAdapter.landCount, 0)

  const abortedAdapter = new FakeGitAdapter()
  const abortedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: abortedAdapter })
  abortedManager.registerSession(createSession())
  const abortedCreated = await prepareCreatedCommit(abortedManager, passedVerificationRunner(), 'landing-abort')
  const abortedDraft = await abortedManager.prepareLanding({ proposalId: abortedCreated.proposal?.proposalId ?? '' })
  const controller = new AbortController()
  controller.abort()
  const interrupted = await abortedManager.confirmLanding(abortedDraft.proposal?.landing?.landingId ?? '', abortedDraft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) }, undefined, controller.signal)
  assert.equal(interrupted.proposal?.landing?.status, 'interrupted')
  assert.equal(interrupted.proposal?.landing?.executionStatus, 'landing-not-performed')
  assert.equal(abortedAdapter.landCount, 0)

  const expiringAdapter = new FakeGitAdapter()
  const expiringManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: expiringAdapter, limits: { expirationMs: 25 } })
  expiringManager.registerSession(createSession())
  const expiringCreated = await prepareCreatedCommit(expiringManager, passedVerificationRunner(), 'landing-expired')
  const expiringDraft = await expiringManager.prepareLanding({ proposalId: expiringCreated.proposal?.proposalId ?? '' })
  await new Promise((resolve) => setTimeout(resolve, 40))
  const expired = await expiringManager.confirmLanding(expiringDraft.proposal?.landing?.landingId ?? '', expiringDraft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'must-not-use', reason: 'must not use' }) })
  assert.equal(expired.proposal?.landing?.status, 'blocked')
  assert.equal(expired.proposal?.landing?.executionStatus, 'landing-not-performed')
  assert.equal(expiringAdapter.landCount, 0)

  const failedAdapter = new FakeGitAdapter()
  failedAdapter.failLanding = true
  const failedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: failedAdapter })
  failedManager.registerSession(createSession())
  const failedCreated = await prepareCreatedCommit(failedManager, passedVerificationRunner(), 'landing-failed')
  const failedDraft = await failedManager.prepareLanding({ proposalId: failedCreated.proposal?.proposalId ?? '' })
  const failed = await failedManager.confirmLanding(failedDraft.proposal?.landing?.landingId ?? '', failedDraft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'approval-failed', reason: 'approved' }) })
  assert.equal(failed.proposal?.landing?.status, 'blocked')
  assert.equal(failed.proposal?.landing?.executionStatus, 'landing-not-performed')
  assert.equal(failedAdapter.landCount, 1)

  const unknownAdapter = new FakeGitAdapter()
  unknownAdapter.failLandingPostcondition = true
  const unknownManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: unknownAdapter })
  unknownManager.registerSession(createSession())
  const unknownCreated = await prepareCreatedCommit(unknownManager, passedVerificationRunner(), 'landing-unknown')
  const unknownDraft = await unknownManager.prepareLanding({ proposalId: unknownCreated.proposal?.proposalId ?? '' })
  const unknown = await unknownManager.confirmLanding(unknownDraft.proposal?.landing?.landingId ?? '', unknownDraft.proposal?.landing?.confirmationDigest ?? '', { authorize: async () => ({ allowed: true, auditId: 'approval-unknown', reason: 'approved' }) })
  assert.equal(unknown.proposal?.landing?.status, 'blocked')
  assert.equal(unknown.proposal?.landing?.executionStatus, 'landing-creation-unknown')
  assert.equal(unknown.proposal?.sourceLanded, false)
  assert.equal(unknownAdapter.landCount, 1)
})

test('patch verification fails closed for missing runner, abort, and unexpected worktree changes', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const draft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const applied = await manager.confirmPatch(draft.proposal?.patch?.patchId ?? '', draft.proposal?.patch?.confirmationDigest ?? '')
  const verifyRequest = {
    patchId: applied.proposal?.patch?.patchId ?? '',
    confirmationDigest: applied.proposal?.patch?.confirmationDigest ?? '',
    recipeId: 'missing',
  }
  const unavailable = await manager.verifyPatch(verifyRequest, undefined)
  assert.equal(unavailable.operationStatus, 'patch-verification-blocked')
  assert.equal(unavailable.proposal?.patch?.status, 'applied')
  assert.equal(unavailable.proposal?.executionStatus.patch, 'patch-applied')

  const secondManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: new FakeGitAdapter() })
  secondManager.registerSession(createSession())
  const secondPending = await secondManager.prepare(request())
  const secondConfirmed = await secondManager.confirm(secondPending.proposal?.proposalId ?? '', secondPending.proposal?.confirmationDigest ?? '')
  const secondDraft = await secondManager.preparePatch({ proposalId: secondConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const secondApplied = await secondManager.confirmPatch(secondDraft.proposal?.patch?.patchId ?? '', secondDraft.proposal?.patch?.confirmationDigest ?? '')
  const aborted = new AbortController()
  aborted.abort()
  const interrupted = await secondManager.verifyPatch({
    patchId: secondApplied.proposal?.patch?.patchId ?? '',
    confirmationDigest: secondApplied.proposal?.patch?.confirmationDigest ?? '',
    recipeId: 'test',
  }, { run: async () => { throw new Error('must not run') } }, undefined, aborted.signal)
  assert.equal(interrupted.proposal?.patch?.verificationStatus, 'interrupted')

  const changedAdapter = new FakeGitAdapter()
  const changedManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: changedAdapter })
  changedManager.registerSession(createSession())
  const changedPending = await changedManager.prepare(request())
  const changedConfirmed = await changedManager.confirm(changedPending.proposal?.proposalId ?? '', changedPending.proposal?.confirmationDigest ?? '')
  const changedDraft = await changedManager.preparePatch({ proposalId: changedConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const changedApplied = await changedManager.confirmPatch(changedDraft.proposal?.patch?.patchId ?? '', changedDraft.proposal?.patch?.confirmationDigest ?? '')
  changedAdapter.changedPaths = ['src/index.ts', 'src/unexpected.ts']
  let unexpectedRunnerCalls = 0
  const unexpected = await changedManager.verifyPatch({
    patchId: changedApplied.proposal?.patch?.patchId ?? '',
    confirmationDigest: changedApplied.proposal?.patch?.confirmationDigest ?? '',
    recipeId: 'test',
  }, { run: async () => { unexpectedRunnerCalls += 1; throw new Error('must not run') } })
  assert.equal(unexpected.operationStatus, 'patch-verification-blocked')
  assert.equal(unexpectedRunnerCalls, 0)
})

test('patch validation accepts declared add/modify/delete files and rejects policy or budget violations', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request({
    targets: [
      { relativePath: 'src/index.ts', operation: 'modify' },
      { relativePath: 'src/new.ts', operation: 'add' },
      { relativePath: 'src/old.ts', operation: 'delete' },
    ],
  }))
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  const multiFilePatch = `${validPatch()}diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const created = true
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
`
  const draft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: multiFilePatch })
  assert.equal(draft.proposal?.patch?.summary.files.map((file) => file.operation).join(','), 'modify,add,delete')
  assert.equal(draft.proposal?.patch?.summary.files.length, 3)

  const invalidPathManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: new FakeGitAdapter() })
  invalidPathManager.registerSession(createSession())
  const invalidPending = await invalidPathManager.prepare(request())
  const invalidConfirmed = await invalidPathManager.confirm(invalidPending.proposal?.proposalId ?? '', invalidPending.proposal?.confirmationDigest ?? '')
  const outside = await invalidPathManager.preparePatch({ proposalId: invalidConfirmed.proposal?.proposalId ?? '', patchText: validPatch().replaceAll('src/index.ts', '../outside.ts') })
  assert.equal(outside.proposal?.patch, undefined)
  assert.match(outside.reason, /outside|traversal|target/)

  const unsupported = await invalidPathManager.preparePatch({ proposalId: invalidConfirmed.proposal?.proposalId ?? '', patchText: validPatch().replace('--- a/src/index.ts', 'old mode 100644\n--- a/src/index.ts') })
  assert.equal(unsupported.proposal?.patch, undefined)
  assert.match(unsupported.reason, /unsupported|mode/)

  const secret = await invalidPathManager.preparePatch({ proposalId: invalidConfirmed.proposal?.proposalId ?? '', patchText: validPatch('token = "sk-abcdefghijklmnop"') })
  assert.equal(secret.proposal?.patch, undefined)
  assert.match(secret.reason, /secret-like/)

  const budgetManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: new FakeGitAdapter(), limits: { maxPatchBytes: 16 } })
  budgetManager.registerSession(createSession())
  const budgetPending = await budgetManager.prepare(request())
  const budgetConfirmed = await budgetManager.confirm(budgetPending.proposal?.proposalId ?? '', budgetPending.proposal?.confirmationDigest ?? '')
  const budget = await budgetManager.preparePatch({ proposalId: budgetConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  assert.match(budget.reason, /budget/)
})

test('patch state machine fails closed for rejection, abort, dirty worktrees, and apply failure', async () => {
  const adapter = new FakeGitAdapter()
  const manager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter })
  manager.registerSession(createSession())
  const pending = await manager.prepare(request())
  const confirmed = await manager.confirm(pending.proposal?.proposalId ?? '', pending.proposal?.confirmationDigest ?? '')
  adapter.dirty = true
  const dirty = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  assert.equal(dirty.proposal?.patch, undefined)
  adapter.dirty = false

  const secondDraft = await manager.preparePatch({ proposalId: confirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const rejected = manager.rejectPatch(secondDraft.proposal?.patch?.patchId ?? '')
  assert.equal(rejected.proposal?.patch?.status, 'rejected')
  const rejectedReplay = await manager.confirmPatch(secondDraft.proposal?.patch?.patchId ?? '', secondDraft.proposal?.patch?.confirmationDigest ?? '')
  assert.equal(rejectedReplay.proposal?.patch?.status, 'rejected')
  assert.equal(adapter.applyPatchCount, 0)

  const thirdPending = await manager.prepare(request())
  const thirdConfirmed = await manager.confirm(thirdPending.proposal?.proposalId ?? '', thirdPending.proposal?.confirmationDigest ?? '')
  const thirdDraft = await manager.preparePatch({ proposalId: thirdConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const aborted = new AbortController()
  aborted.abort()
  const interrupted = await manager.confirmPatch(thirdDraft.proposal?.patch?.patchId ?? '', thirdDraft.proposal?.patch?.confirmationDigest ?? '', aborted.signal)
  assert.equal(interrupted.proposal?.patch?.status, 'interrupted')
  assert.equal(adapter.applyPatchCount, 0)

  const failureManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: Object.assign(new FakeGitAdapter(), { failPatch: true }) })
  failureManager.registerSession(createSession())
  const failurePending = await failureManager.prepare(request())
  const failureConfirmed = await failureManager.confirm(failurePending.proposal?.proposalId ?? '', failurePending.proposal?.confirmationDigest ?? '')
  const failureDraft = await failureManager.preparePatch({ proposalId: failureConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  const failed = await failureManager.confirmPatch(failureDraft.proposal?.patch?.patchId ?? '', failureDraft.proposal?.patch?.confirmationDigest ?? '')
  assert.equal(failed.proposal?.patch?.status, 'blocked')
  assert.equal(failed.proposal?.patch?.executionStatus, 'patch-not-applied')

  const identityAdapter = new FakeGitAdapter()
  const identityManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: identityAdapter })
  identityManager.registerSession(createSession())
  const identityPending = await identityManager.prepare(request())
  const identityConfirmed = await identityManager.confirm(identityPending.proposal?.proposalId ?? '', identityPending.proposal?.confirmationDigest ?? '')
  const identityDraft = await identityManager.preparePatch({ proposalId: identityConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  identityAdapter.identityMismatch = true
  const identityBlocked = await identityManager.confirmPatch(identityDraft.proposal?.patch?.patchId ?? '', identityDraft.proposal?.patch?.confirmationDigest ?? '')
  assert.equal(identityBlocked.proposal?.patch?.status, 'blocked')
  assert.equal(identityAdapter.applyPatchCount, 0)

  const postconditionAdapter = new FakeGitAdapter()
  const postconditionManager = new ChangeProposalManager(createConfig(fixtureRoot), { adapter: postconditionAdapter })
  postconditionManager.registerSession(createSession())
  const postconditionPending = await postconditionManager.prepare(request())
  const postconditionConfirmed = await postconditionManager.confirm(postconditionPending.proposal?.proposalId ?? '', postconditionPending.proposal?.confirmationDigest ?? '')
  const postconditionDraft = await postconditionManager.preparePatch({ proposalId: postconditionConfirmed.proposal?.proposalId ?? '', patchText: validPatch() })
  postconditionAdapter.failPostcondition = true
  const unknown = await postconditionManager.confirmPatch(postconditionDraft.proposal?.patch?.patchId ?? '', postconditionDraft.proposal?.patch?.confirmationDigest ?? '')
  assert.equal(unknown.proposal?.patch?.status, 'blocked')
  assert.equal(unknown.proposal?.patch?.executionStatus, 'patch-application-unknown')
  assert.equal(unknown.proposal?.executionStatus.patch, 'patch-application-unknown')
})

test('node Git adapter creates and removes a detached worktree without network access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-atlas-git-'))
  try {
    await runGit(root, ['init', '-q'])
    // These synthetic fixtures assert exact LF bytes across real worktree checkouts.
    await runGit(root, ['config', 'core.autocrlf', 'false'])
    await runGit(root, ['config', 'user.email', 'repo-atlas@example.test'])
    await runGit(root, ['config', 'user.name', 'RepoAtlas Test'])
    await fs.writeFile(path.join(root, 'README.md'), 'fixture\n')
    await runGit(root, ['add', 'README.md'])
    await runGit(root, ['commit', '-qm', 'fixture'])
    await fs.writeFile(path.join(root, 'local-change.txt'), 'must stay in source only')

    const adapter = createNodeGitWorktreeAdapter()
    const revision = await adapter.discover(root)
    const worktree = await adapter.create(revision.repositoryRoot, revision.baseRevision)
    assert.equal(path.resolve(worktree.path).startsWith(path.resolve(root)), false)
    assert.equal(await fs.readFile(path.join(root, 'local-change.txt'), 'utf8'), 'must stay in source only')
    await assert.rejects(() => fs.access(path.join(worktree.path, 'local-change.txt')))
    const inspected = await adapter.inspect(revision.repositoryRoot, worktree)
    assert.equal(inspected.dirty, false)
    assert.equal(inspected.identity, worktree.identity)
    await adapter.applyPatch(revision.repositoryRoot, worktree, `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-fixture
+patched
`, '')
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'fixture\n')
    assert.equal(await fs.readFile(path.join(worktree.path, 'README.md'), 'utf8'), 'patched\n')
    const patched = await adapter.inspect(revision.repositoryRoot, worktree)
    assert.equal(patched.dirty, true)
    assert.deepEqual(patched.changedPaths, ['README.md'])
    const commitRevision = await adapter.commit(revision.repositoryRoot, worktree, ['README.md'], 'feat: isolated fixture change')
    assert.match(commitRevision, /^[0-9a-f]{40}$/)
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'fixture\n')
    assert.equal(await fs.readFile(path.join(worktree.path, 'README.md'), 'utf8'), 'patched\n')
    const committed = await adapter.inspect(revision.repositoryRoot, worktree)
    assert.equal(committed.dirty, false)
    assert.deepEqual(committed.changedPaths, [])
    assert.equal(committed.baseRevision, commitRevision)
    assert.equal(committed.identity, worktree.identity)
    await adapter.remove(revision.repositoryRoot, worktree)
    await assert.rejects(() => fs.access(worktree.path))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('node Git adapter fast-forwards the clean source workspace from an isolated commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-atlas-landing-'))
  try {
    await runGit(root, ['init', '-q'])
    // These synthetic fixtures assert exact LF bytes across real worktree checkouts.
    await runGit(root, ['config', 'core.autocrlf', 'false'])
    await runGit(root, ['config', 'user.email', 'repo-atlas@example.test'])
    await runGit(root, ['config', 'user.name', 'RepoAtlas Test'])
    await fs.writeFile(path.join(root, 'README.md'), 'fixture\n')
    await runGit(root, ['add', 'README.md'])
    await runGit(root, ['commit', '-qm', 'fixture'])

    const adapter = createNodeGitWorktreeAdapter()
    const revision = await adapter.discover(root)
    const worktree = await adapter.create(revision.repositoryRoot, revision.baseRevision)
    await adapter.applyPatch(revision.repositoryRoot, worktree, `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-fixture
+landed
`, '')
    const commitRevision = await adapter.commit(revision.repositoryRoot, worktree, ['README.md'], 'feat: land fixture change')
    const sourceBefore = await adapter.inspectSource(revision.repositoryRoot, root)
    assert.equal(sourceBefore.revision, revision.baseRevision)
    assert.equal(sourceBefore.dirty, false)
    const preflight = await adapter.inspectLanding(revision.repositoryRoot, root, revision.baseRevision, commitRevision)
    assert.equal(preflight.source.revision, revision.baseRevision)
    assert.equal(preflight.targetRevision, commitRevision)
    assert.equal(preflight.sourceIsAncestor, true)
    assert.equal(preflight.targetIsAncestor, false)
    const landedRevision = await adapter.land(revision.repositoryRoot, root, revision.baseRevision, commitRevision)
    assert.equal(landedRevision, commitRevision)
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'landed\n')
    const sourceAfter = await adapter.inspectSource(revision.repositoryRoot, root)
    assert.equal(sourceAfter.revision, commitRevision)
    assert.equal(sourceAfter.dirty, false)
    const postflight = await adapter.inspectLanding(revision.repositoryRoot, root, revision.baseRevision, commitRevision)
    assert.equal(postflight.source.revision, commitRevision)
    assert.equal(postflight.sourceIsAncestor, true)
    assert.equal(postflight.targetIsAncestor, true)
    const committed = await adapter.inspect(revision.repositoryRoot, worktree)
    assert.equal(committed.dirty, false)
    assert.equal(committed.identity, worktree.identity)
    await adapter.remove(revision.repositoryRoot, worktree)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('node Git adapter refuses source revision drift without creating a merge', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-atlas-landing-drift-'))
  try {
    await runGit(root, ['init', '-q'])
    // These synthetic fixtures assert exact LF bytes across real worktree checkouts.
    await runGit(root, ['config', 'core.autocrlf', 'false'])
    await runGit(root, ['config', 'user.email', 'repo-atlas@example.test'])
    await runGit(root, ['config', 'user.name', 'RepoAtlas Test'])
    await fs.writeFile(path.join(root, 'README.md'), 'fixture\n')
    await runGit(root, ['add', 'README.md'])
    await runGit(root, ['commit', '-qm', 'fixture'])

    const adapter = createNodeGitWorktreeAdapter()
    const revision = await adapter.discover(root)
    const worktree = await adapter.create(revision.repositoryRoot, revision.baseRevision)
    await adapter.applyPatch(revision.repositoryRoot, worktree, `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-fixture
+isolated
`, '')
    const commitRevision = await adapter.commit(revision.repositoryRoot, worktree, ['README.md'], 'feat: isolated divergent change')
    await fs.writeFile(path.join(root, 'README.md'), 'source-diverged\n')
    await runGit(root, ['add', 'README.md'])
    await runGit(root, ['commit', '-qm', 'source diverged'])
    await assert.rejects(() => adapter.land(revision.repositoryRoot, root, revision.baseRevision, commitRevision), /expected base revision/)
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'source-diverged\n')
    await adapter.remove(revision.repositoryRoot, worktree)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, shell: false, windowsHide: true, maxBuffer: 64 * 1024 })
}
