import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply, name as pluginName } from '../src/harness/plugin.ts'
import { createChangeProposalVerificationRunner } from '../src/harness/change-proposal-verification.ts'
import { createChangeProposalCommitAuthorizer } from '../src/harness/change-proposal-commit.ts'
import { createChangeProposalLandingAuthorizer } from '../src/harness/change-proposal-landing.ts'
import { HarnessSessionRuntimeRegistry } from '../src/harness/session-runtime.ts'
import { createConfig } from '../src/config.ts'
import type { HarnessSession, HarnessTool, HarnessToolExecution } from '../src/harness/public.ts'

function harnessExecution(workspaceRoot: string, session: HarnessSession = { header: { cwd: workspaceRoot } }, callId = 'repo-atlas-test-call'): HarnessToolExecution {
  return { callId, agent: { session }, signal: new AbortController().signal }
}

function registeredTools(pluginConfig: Parameters<typeof apply>[1] = {}): HarnessTool[] {
  const tools: HarnessTool[] = []
  apply({ tools: { register: (tool) => tools.push(tool) } }, pluginConfig)
  return tools
}

test('analysis follows each calling Harness session cwd', async () => {
  const completeRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const sensitiveRoot = path.join(process.cwd(), 'test', 'fixtures', 'sensitive-repo')
  const analysis = registeredTools().find((tool) => tool.name === 'repo_atlas_analyze')
  assert.ok(analysis)

  const complete = await analysis.execute(
    { start: 'direct', goal: { intent: 'onboarding' } },
    harnessExecution(completeRoot),
  ) as { report?: { atlas: { project: { name: string }; evidence: Array<{ sourcePath: string; status: string }> } } }
  const sensitive = await analysis.execute(
    { start: 'direct', goal: { intent: 'onboarding' } },
    harnessExecution(sensitiveRoot),
  ) as { report?: { atlas: { project: { name: string }; evidence: Array<{ sourcePath: string; status: string }> } } }

  assert.equal(complete.report?.atlas.project.name, 'fixture-app')
  assert.equal(sensitive.report?.atlas.project.name, 'sensitive-repo')
  assert.ok(complete.report?.atlas.evidence.some((item) => item.sourcePath === 'package.json'))
  assert.ok(sensitive.report?.atlas.evidence.some((item) => item.sourcePath === 'package.json' && item.status === 'read-failed'))
  assert.ok(sensitive.report?.atlas.evidence.every((item) => !item.sourcePath.startsWith('src/')))
})

test('proposal state is isolated by exact Harness session object even at the same cwd', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const sessionA: HarnessSession = { header: { cwd: workspaceRoot } }
  const sessionB: HarnessSession = { header: { cwd: workspaceRoot } }
  const tools = registeredTools()
  const analysis = tools.find((tool) => tool.name === 'repo_atlas_analyze')
  const proposal = tools.find((tool) => tool.name === 'repo_atlas_change_proposal')
  assert.ok(analysis)
  assert.ok(proposal)

  const analyzed = await analysis.execute(
    { start: 'direct', goal: { intent: 'onboarding' } },
    harnessExecution(workspaceRoot, sessionA, 'analysis-a'),
  ) as { report?: { sessionId: string } }
  const prepared = await proposal.execute({
    action: 'prepare',
    sessionId: analyzed.report?.sessionId,
    intent: 'prove exact session isolation',
    targets: [{ relativePath: 'src/index.ts', operation: 'modify' }],
  }, harnessExecution(workspaceRoot, sessionA, 'proposal-a')) as { proposal?: { proposalId: string } }
  assert.ok(prepared.proposal?.proposalId)

  const ownerList = await proposal.execute(
    { action: 'list' },
    harnessExecution(workspaceRoot, sessionA, 'list-a'),
  ) as { total: number }
  const otherList = await proposal.execute(
    { action: 'list' },
    harnessExecution(workspaceRoot, sessionB, 'list-b'),
  ) as { total: number }
  const otherInspect = await proposal.execute(
    { action: 'inspect', proposalId: prepared.proposal?.proposalId },
    harnessExecution(workspaceRoot, sessionB, 'inspect-b'),
  ) as { status: string }

  assert.equal(ownerList.total, 1)
  assert.equal(otherList.total, 0)
  assert.equal(otherInspect.status, 'blocked')
})

test('session runtime resolution fails closed for missing, invalid, mismatched, and cancelled invocation context', () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const otherRoot = path.join(process.cwd(), 'test', 'fixtures', 'sensitive-repo')
  const registry = new HarnessSessionRuntimeRegistry({ workspaceRoot })

  assert.equal(registry.resolve(undefined).ok, false)
  assert.equal(registry.resolve({ signal: new AbortController().signal }).ok, false)
  assert.equal(registry.resolve({ agent: { session: { header: { cwd: 'relative/path' } } }, signal: new AbortController().signal }).ok, false)
  assert.equal(registry.resolve(harnessExecution(otherRoot)).ok, false)
  assert.equal(registry.resolve({
    agent: { session: { header: { cwd: workspaceRoot } } },
    signal: AbortSignal.abort(),
  }).ok, false)
})

test('pre-aborted analysis is blocked before repository work starts', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const analysis = registeredTools({ workspaceRoot }).find((tool) => tool.name === 'repo_atlas_analyze')
  assert.ok(analysis)
  const result = await analysis.execute(
    { start: 'direct', goal: { intent: 'onboarding' } },
    { agent: { session: { header: { cwd: workspaceRoot } } }, signal: AbortSignal.abort() },
  ) as { blocked?: { reason: string }; report?: unknown }
  assert.match(result.blocked?.reason ?? '', /cancelled/)
  assert.equal(result.report, undefined)
})

test('Harness adapter registers read-only analysis and session-only proposal tools', async () => {
  const registered: HarnessTool[] = []
  const logs: string[] = []
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const execution = harnessExecution(workspaceRoot)
  apply({ tools: { register: (tool) => registered.push(tool) }, logger: { info: (message) => logs.push(message), warn: () => undefined } }, { workspaceRoot })
  assert.equal(registered.length, 4)
  assert.equal(pluginName, 'dsh-repo-atlas')
  const analysisTool = registered.find((tool) => tool.name === 'repo_atlas_analyze')
  const proposalTool = registered.find((tool) => tool.name === 'repo_atlas_change_proposal')
  assert.ok(analysisTool)
  assert.ok(proposalTool)
  const analysis = { ...analysisTool, execute: (input: unknown) => analysisTool.execute(input, execution) }
  const proposal = { ...proposalTool, execute: (input: unknown) => proposalTool.execute(input, execution) }
  assert.match(JSON.stringify(proposal.parameters), /prepare-patch/)
  assert.match(JSON.stringify(proposal.parameters), /review-patch/)
  assert.match(JSON.stringify(proposal.parameters), /export-patch/)
  assert.match(JSON.stringify(proposal.parameters), /confirm-patch/)
  assert.match(JSON.stringify(proposal.parameters), /reject-patch/)
  assert.match(JSON.stringify(proposal.parameters), /verify-patch/)
  assert.match(JSON.stringify(proposal.parameters), /prepare-commit/)
  assert.match(JSON.stringify(proposal.parameters), /confirm-commit/)
  assert.match(JSON.stringify(proposal.parameters), /reject-commit/)
  assert.match(JSON.stringify(proposal.parameters), /prepare-landing/)
  assert.match(JSON.stringify(proposal.parameters), /confirm-landing/)
  assert.match(JSON.stringify(proposal.parameters), /reject-landing/)
  assert.match(JSON.stringify(proposal.parameters), /inspect/)
  assert.match(JSON.stringify(proposal.parameters), /list/)
  assert.match(JSON.stringify(proposal.parameters), /history/)
  assert.match(JSON.stringify(proposal.parameters), /inspect-recovery/)
  assert.match(JSON.stringify(proposal.parameters), /inspect-live/)
  assert.match(JSON.stringify(proposal.parameters), /inspect-landing/)
  assert.match(JSON.stringify(proposal.parameters), /inspect-release/)
  assert.match(JSON.stringify(proposal.parameters), /limit/)
  assert.deepEqual(analysis.output.schema, { type: 'object' })
  assert.match(analysis.output.render({}, { policy: 'readonly' })[0]?.text ?? '', /"policy": "readonly"/)

  const analyzed = await analysis.execute({ start: 'direct', goal: { intent: 'onboarding' } }) as { report?: { sessionId: string } }
  assert.ok(analyzed.report?.sessionId)
  const prepared = await proposal.execute({
    action: 'prepare',
    sessionId: analyzed.report?.sessionId,
    intent: 'inspect lifecycle state',
    targets: [{ relativePath: 'src/index.ts', operation: 'modify' }],
  }) as { proposal?: { proposalId: string; status: string } }
  assert.equal(prepared.proposal?.status, 'awaiting-confirmation')
  const inspected = await proposal.execute({ action: 'inspect', proposalId: prepared.proposal?.proposalId }) as { status: string; operationStatus: string; proposal?: { proposalId: string } }
  assert.equal(inspected.status, 'awaiting-confirmation')
  assert.equal(inspected.operationStatus, 'proposal')
  assert.equal(inspected.proposal?.proposalId, prepared.proposal?.proposalId)
  const missingInspect = await proposal.execute({ action: 'inspect' }) as { status: string; operationStatus: string }
  assert.equal(missingInspect.status, 'blocked')
  assert.equal(missingInspect.operationStatus, 'blocked')
  const unknownInspect = await proposal.execute({ action: 'inspect', proposalId: 'proposal-unknown' }) as { status: string; operationStatus: string }
  assert.equal(unknownInspect.status, 'blocked')
  assert.equal(unknownInspect.operationStatus, 'blocked')
  const listed = await proposal.execute({ action: 'list', limit: 1 }) as { status: string; total: number; returned: number; truncated: boolean; proposals?: Array<{ proposalId: string }> }
  assert.equal(listed.status, 'available')
  assert.equal(listed.total, 1)
  assert.equal(listed.returned, 1)
  assert.equal(listed.truncated, false)
  assert.equal(listed.proposals?.[0]?.proposalId, prepared.proposal?.proposalId)
  const history = await proposal.execute({ action: 'history', proposalId: prepared.proposal?.proposalId }) as { status: string; proposalId?: string; total: number; returned: number; truncated: boolean; events?: Array<{ phase: string; operationStatus: string }> }
  assert.equal(history.status, 'available')
  assert.equal(history.proposalId, prepared.proposal?.proposalId)
  assert.equal(history.total, 1)
  assert.equal(history.returned, 1)
  assert.equal(history.truncated, false)
  assert.equal(history.events?.[0]?.phase, 'proposal')
  assert.equal(history.events?.[0]?.operationStatus, 'proposal')
  const recovery = await proposal.execute({ action: 'inspect-recovery', proposalId: prepared.proposal?.proposalId }) as { status: string; guidance?: { recommendation: string; allowedActions: string[]; manualReviewRequired: boolean; proposal?: { proposalId: string } } }
  assert.equal(recovery.status, 'available')
  assert.equal(recovery.guidance?.recommendation, 'confirm')
  assert.deepEqual(recovery.guidance?.allowedActions, ['confirm', 'reject'])
  assert.equal(recovery.guidance?.manualReviewRequired, false)
  assert.equal(recovery.guidance?.proposal?.proposalId, prepared.proposal?.proposalId)
  const missingRecovery = await proposal.execute({ action: 'inspect-recovery' }) as { status: string; guidance?: unknown }
  assert.equal(missingRecovery.status, 'blocked')
  assert.equal(missingRecovery.guidance, undefined)
  const unknownRecovery = await proposal.execute({ action: 'inspect-recovery', proposalId: 'proposal-unknown' }) as { status: string; guidance?: unknown }
  assert.equal(unknownRecovery.status, 'blocked')
  assert.equal(unknownRecovery.guidance, undefined)
  const missingHistory = await proposal.execute({ action: 'history' }) as { status: string; events?: unknown[]; total: number }
  assert.equal(missingHistory.status, 'blocked')
  assert.deepEqual(missingHistory.events, [])
  assert.equal(missingHistory.total, 0)
  const invalidHistory = await proposal.execute({ action: 'history', proposalId: prepared.proposal?.proposalId, limit: 0 }) as { status: string; events?: unknown[]; total: number }
  assert.equal(invalidHistory.status, 'blocked')
  assert.deepEqual(invalidHistory.events, [])
  assert.equal(invalidHistory.total, 0)
  const invalidList = await proposal.execute({ action: 'list', limit: 0 }) as { status: string; returned: number; proposals?: unknown[] }
  assert.equal(invalidList.status, 'blocked')
  assert.equal(invalidList.returned, 0)
  assert.deepEqual(invalidList.proposals, [])
  const invalidTypeList = await proposal.execute({ action: 'list', limit: 'many' }) as { status: string; returned: number }
  assert.equal(invalidTypeList.status, 'blocked')
  assert.equal(invalidTypeList.returned, 0)
  const live = await proposal.execute({ action: 'inspect-live', proposalId: prepared.proposal?.proposalId }) as { status: string; liveInspection?: { status: string; source?: { status: string }; worktree?: { status: string } } }
  assert.equal(live.status, 'awaiting-confirmation')
  assert.equal(live.liveInspection?.status, 'available')
  assert.equal(live.liveInspection?.source?.status, 'available')
  assert.equal(live.liveInspection?.worktree?.status, 'not-applicable')
  const missingLive = await proposal.execute({ action: 'inspect-live' }) as { status: string; operationStatus: string }
  assert.equal(missingLive.status, 'blocked')
  assert.equal(missingLive.operationStatus, 'blocked')
  const unknownLive = await proposal.execute({ action: 'inspect-live', proposalId: 'proposal-unknown' }) as { status: string; liveInspection?: unknown }
  assert.equal(unknownLive.status, 'blocked')
  assert.equal(unknownLive.liveInspection, undefined)
  const landing = await proposal.execute({ action: 'inspect-landing', proposalId: prepared.proposal?.proposalId }) as { status: string; landingAssessment?: { status: string; relation: string } }
  assert.equal(landing.status, 'awaiting-confirmation')
  assert.equal(landing.landingAssessment?.status, 'not-applicable')
  assert.equal(landing.landingAssessment?.relation, 'not-applicable')
  const missingLanding = await proposal.execute({ action: 'inspect-landing' }) as { status: string; operationStatus: string }
  assert.equal(missingLanding.status, 'blocked')
  assert.equal(missingLanding.operationStatus, 'blocked')
  const unknownLanding = await proposal.execute({ action: 'inspect-landing', proposalId: 'proposal-unknown' }) as { status: string; landingAssessment?: unknown }
  assert.equal(unknownLanding.status, 'blocked')
  assert.equal(unknownLanding.landingAssessment, undefined)
  const release = await proposal.execute({ action: 'inspect-release', proposalId: prepared.proposal?.proposalId }) as { status: string; releaseAssessment?: { status: string; relation: string } }
  assert.equal(release.status, 'awaiting-confirmation')
  assert.equal(release.releaseAssessment?.status, 'not-applicable')
  assert.equal(release.releaseAssessment?.relation, 'not-applicable')
  const missingRelease = await proposal.execute({ action: 'inspect-release' }) as { status: string; operationStatus: string }
  assert.equal(missingRelease.status, 'blocked')
  assert.equal(missingRelease.operationStatus, 'blocked')
  const unknownRelease = await proposal.execute({ action: 'inspect-release', proposalId: 'proposal-unknown' }) as { status: string; releaseAssessment?: unknown }
  assert.equal(unknownRelease.status, 'blocked')
  assert.equal(unknownRelease.releaseAssessment, undefined)
  const clarification = await analysis.execute({}) as { clarification?: { question?: { field?: string } } }
  assert.equal(clarification.clarification?.question?.field, 'intent')
  assert.ok(logs.some((message) => message.includes('read-only')))
})

test('commit authorizer requires an active armed Goal and one-time Harness approval', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  let approvalRequest: { toolName: string; callId?: string; reason?: string } | undefined
  const authorizer = createChangeProposalCommitAuthorizer({
    get: <T>(name: string) => {
      if (name === 'goals') return { get: () => ({ phase: 'active', activation: 'armed' }) } as T
      if (name === 'approval') return {
        request: async (request: { toolName: string; callId?: string; reason?: string }) => {
          approvalRequest = request
          return 'allowed-once'
        },
      } as T
      return undefined
    },
    tools: { register: () => undefined },
  })
  const result = await authorizer.authorize({
    commitId: 'commit-test',
    confirmationDigest: 'digest',
    commitMessage: 'feat: test commit',
    worktree: { path: workspaceRoot, identity: 'owned', baseRevision: 'head' },
    execution: { callId: 'commit-call', agent: { session: { header: { cwd: workspaceRoot } } } },
  })
  assert.equal(result.allowed, true)
  assert.match(result.auditId ?? '', /^commit-approval-/)
  assert.equal(approvalRequest?.toolName, 'repo_atlas_change_proposal')
  assert.equal(approvalRequest?.callId, 'commit-call')
  assert.match(approvalRequest?.reason ?? '', /isolated commit/)
})

test('source landing authorizer requires an active armed Goal and one-time Harness approval', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  let approvalRequest: { toolName: string; callId?: string; reason?: string } | undefined
  const authorizer = createChangeProposalLandingAuthorizer({
    get: <T>(name: string) => {
      if (name === 'goals') return { get: () => ({ phase: 'active', activation: 'armed' }) } as T
      if (name === 'approval') return {
        request: async (request: { toolName: string; callId?: string; reason?: string }) => {
          approvalRequest = request
          return 'allowed-once'
        },
      } as T
      return undefined
    },
    tools: { register: () => undefined },
  })
  const result = await authorizer.authorize({
    landingId: 'landing-test',
    confirmationDigest: 'digest',
    sourcePath: workspaceRoot,
    commitRevision: 'a'.repeat(40),
    execution: { callId: 'landing-call', agent: { session: { header: { cwd: workspaceRoot } } } },
  })
  assert.equal(result.allowed, true)
  assert.match(result.auditId ?? '', /^landing-approval-/)
  assert.equal(approvalRequest?.toolName, 'repo_atlas_change_proposal')
  assert.equal(approvalRequest?.callId, 'landing-call')
  assert.match(approvalRequest?.reason ?? '', /source landing/)
})

test('patch verification runner reuses Harness approval and executes only at the owned worktree root', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const recipe = {
    id: 'test',
    command: 'npm',
    args: ['test'],
    sandboxMode: 'read-only' as const,
    timeoutMs: 30_000,
    maxOutputBytes: 32_000,
    enabled: true,
  }
  const agent = { session: { header: { cwd: workspaceRoot } } }
  const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-atlas-verify-'))
  let approvalRequest: { toolName: string; callId?: string; reason?: string } | undefined
  let policyRequest: { mode?: string; session?: unknown } | undefined
  let spawnCount = 0
  const services: Record<string, unknown> = {
    goals: { get: () => ({ phase: 'active', activation: 'armed' }) },
    approval: {
      request: async (request: { toolName: string; callId?: string; reason?: string }) => {
        approvalRequest = request
        return 'allowed-once'
      },
    },
    sandboxPolicy: {
      resolve: (request: { mode?: 'read-only' | 'workspace-write'; session?: unknown }) => {
        policyRequest = request
        return { mode: request.mode, workspaceRoot: isolatedRoot }
      },
    },
    sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }) },
    subprocess: {
      spawn: (request: { cwd: string }) => {
        spawnCount += 1
        assert.equal(request.cwd, isolatedRoot)
        return {
          collected: { stdout: { readFrom: () => ({ text: 'verified', nextOffset: 8, lossy: false }) } },
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate() {},
        }
      },
    },
  }
  const runner = createChangeProposalVerificationRunner(createConfig(workspaceRoot, { controlledActions: { enabled: true, recipes: [recipe] } }), {
    get: <T>(name: string) => services[name] as T | undefined,
    tools: { register: () => undefined },
  })
  const result = await runner.run({
    recipeId: 'test',
    worktree: { path: isolatedRoot, identity: 'owned-worktree', baseRevision: 'head' },
    execution: { callId: 'verify-call', agent },
    signal: new AbortController().signal,
  })
  assert.equal(result.status, 'passed')
  assert.equal(result.stdout, 'verified')
  assert.deepEqual(policyRequest, { mode: 'read-only', session: agent.session })
  assert.equal(spawnCount, 1)
  assert.equal(approvalRequest?.toolName, 'repo_atlas_change_proposal')
  assert.equal(approvalRequest?.callId, 'verify-call')
  await fs.rm(isolatedRoot, { recursive: true, force: true })
})

test('patch verification runner rejects writable recipes before approval or subprocess start', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-atlas-verify-'))
  let approvalCount = 0
  let spawnCount = 0
  const runner = createChangeProposalVerificationRunner(createConfig(workspaceRoot, {
    controlledActions: {
      enabled: true,
      recipes: [{ id: 'write', command: 'npm', args: ['test'], sandboxMode: 'workspace-write', timeoutMs: 30_000, maxOutputBytes: 1_024, enabled: true }],
    },
  }), {
    get: <T>(name: string) => {
      if (name === 'goals') return { get: () => ({ phase: 'active', activation: 'armed' }) } as T
      if (name === 'approval') return { request: async () => { approvalCount += 1; return 'allowed-once' } } as T
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'read-only', workspaceRoot: isolatedRoot }) } as T
      if (name === 'sandbox') return { confine: (argv: readonly string[]) => ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }) } as T
      if (name === 'subprocess') return { spawn: () => { spawnCount += 1; throw new Error('must not spawn') } } as T
      return undefined
    },
    tools: { register: () => undefined },
  })
  const result = await runner.run({
    recipeId: 'write',
    worktree: { path: isolatedRoot, identity: 'owned-worktree', baseRevision: 'head' },
    execution: { callId: 'verify-write', agent: { session: { header: { cwd: workspaceRoot } } } },
    signal: new AbortController().signal,
  })
  assert.equal(result.status, 'denied')
  assert.match(result.reason, /read-only/)
  assert.equal(approvalCount, 0)
  assert.equal(spawnCount, 0)
  await fs.rm(isolatedRoot, { recursive: true, force: true })
})

test('registered tool keeps the clarification gate and produces a report after direct start', async () => {
  const registered: HarnessTool[] = []
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  apply({ tools: { register: (registeredTool) => { registered.push(registeredTool) } } }, {
    workspaceRoot,
  })
  const tool = registered.find((candidate) => candidate.name === 'repo_atlas_analyze')
  assert.ok(tool)
  const result = await tool.execute({ start: 'direct', goal: { intent: 'onboarding' } }, harnessExecution(workspaceRoot)) as { policy: string; report?: { markdown?: string } }
  assert.equal(result.policy, 'readonly')
  assert.match(result.report?.markdown ?? '', /RepoAtlas/)
})

test('enabled controlled action tool uses host Goal and one-time Harness approval', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const recipe = {
    id: 'test',
    command: 'npm',
    args: ['test'],
    sandboxMode: 'read-only' as const,
    timeoutMs: 30_000,
    maxOutputBytes: 32_000,
    enabled: true,
  }
  const registered: HarnessTool[] = []
  const agent = { session: { header: { cwd: workspaceRoot } } }
  let approvalRequest: { toolName: string; callId?: string; reason?: string } | undefined
  let policyRequest: { mode?: string; session?: unknown } | undefined
  let spawnCount = 0
  const services: Record<string, unknown> = {
    goals: { get: () => ({ phase: 'active', activation: 'armed' }) },
    approval: {
      request: async (request: { toolName: string; callId?: string; reason?: string }) => {
        approvalRequest = request
        return 'allowed-once'
      },
    },
    sandboxPolicy: {
      resolve: (request: { mode?: 'read-only' | 'workspace-write'; session?: unknown }) => {
        policyRequest = request
        return { mode: request.mode, workspaceRoot }
      },
    },
    sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }) },
    subprocess: {
      spawn: () => {
        spawnCount += 1
        return {
          collected: { stdout: { readFrom: () => ({ text: 'ok', nextOffset: 2, lossy: false }) } },
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate() {},
        }
      },
    },
  }
  apply({
    tools: { register: (tool) => registered.push(tool) },
    get: <T>(name: string) => services[name] as T | undefined,
  }, { workspaceRoot, controlledActions: { enabled: true, recipes: [recipe] } })

  const action = registered.find((tool) => tool.name === 'repo_atlas_controlled_action')
  assert.ok(action)
  const result = await action.execute({ recipeId: 'test', cwd: 'src' }, { callId: 'call-1', agent, signal: new AbortController().signal }) as { status: string; auditId?: string }
  assert.equal(result.status, 'success')
  assert.match(result.auditId ?? '', /^action-/)
  assert.equal(spawnCount, 1)
  assert.equal(approvalRequest?.toolName, 'repo_atlas_controlled_action')
  assert.equal(approvalRequest?.callId, 'call-1')
  assert.match(approvalRequest?.reason ?? '', /test.*src.*read-only/)
  assert.deepEqual(policyRequest, { mode: 'read-only', session: agent.session })
})

test('controlled action tool rejects Harness sandbox policy root drift before confinement or spawn', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const otherRoot = path.join(process.cwd(), 'test', 'fixtures', 'sensitive-repo')
  let confineCount = 0
  let spawnCount = 0
  const registered: HarnessTool[] = []
  const services: Record<string, unknown> = {
    goals: { get: () => ({ phase: 'active', activation: 'armed' }) },
    approval: { request: async () => 'allowed-once' },
    sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: otherRoot }) },
    sandbox: { confine: () => { confineCount += 1; throw new Error('must not confine') } },
    subprocess: { spawn: () => { spawnCount += 1; throw new Error('must not spawn') } },
  }
  apply({
    tools: { register: (tool) => registered.push(tool) },
    get: <T>(name: string) => services[name] as T | undefined,
  }, {
    workspaceRoot,
    controlledActions: {
      enabled: true,
      recipes: [{ id: 'test', command: 'npm', args: ['test'], sandboxMode: 'read-only', timeoutMs: 30_000, maxOutputBytes: 32_000, enabled: true }],
    },
  })
  const action = registered.find((tool) => tool.name === 'repo_atlas_controlled_action')
  assert.ok(action)
  const result = await action.execute(
    { recipeId: 'test' },
    harnessExecution(workspaceRoot),
  ) as { status: string; reason: string }
  assert.equal(result.status, 'sandbox-unavailable')
  assert.match(result.reason, /workspace does not match/)
  assert.equal(confineCount, 0)
  assert.equal(spawnCount, 0)
})

test('controlled action tool rejects an unconfined Harness sandbox mode before confinement or spawn', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  let confineCount = 0
  let spawnCount = 0
  const registered: HarnessTool[] = []
  const services: Record<string, unknown> = {
    goals: { get: () => ({ phase: 'active', activation: 'armed' }) },
    approval: { request: async () => 'allowed-once' },
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access', workspaceRoot }) },
    sandbox: { confine: () => { confineCount += 1; throw new Error('must not confine') } },
    subprocess: { spawn: () => { spawnCount += 1; throw new Error('must not spawn') } },
  }
  apply({
    tools: { register: (tool) => registered.push(tool) },
    get: <T>(name: string) => services[name] as T | undefined,
  }, {
    workspaceRoot,
    controlledActions: {
      enabled: true,
      recipes: [{ id: 'test', command: 'npm', args: ['test'], sandboxMode: 'read-only', timeoutMs: 30_000, maxOutputBytes: 32_000, enabled: true }],
    },
  })
  const action = registered.find((tool) => tool.name === 'repo_atlas_controlled_action')
  assert.ok(action)
  const result = await action.execute(
    { recipeId: 'test' },
    harnessExecution(workspaceRoot),
  ) as { status: string; reason: string }
  assert.equal(result.status, 'sandbox-unavailable')
  assert.match(result.reason, /unsupported sandbox mode/)
  assert.equal(confineCount, 0)
  assert.equal(spawnCount, 0)
})

test('controlled action tool rejects an unknown recipe before asking for approval', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  let approvalCount = 0
  let spawnCount = 0
  const services: Record<string, unknown> = {
    goals: { get: () => ({ phase: 'active', activation: 'armed' }) },
    approval: { request: async () => { approvalCount += 1; return 'allowed-once' } },
    sandboxPolicy: { resolve: ({ mode }: { mode: 'read-only' | 'workspace-write' }) => ({ mode, workspaceRoot }) },
    sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }) },
    subprocess: { spawn: () => { spawnCount += 1; throw new Error('must not spawn') } },
  }
  const registered: HarnessTool[] = []
  apply({
    tools: { register: (tool) => registered.push(tool) },
    get: <T>(name: string) => services[name] as T | undefined,
  }, { workspaceRoot, controlledActions: { enabled: true, recipes: [] } })
  const action = registered.find((tool) => tool.name === 'repo_atlas_controlled_action')
  assert.ok(action)
  const result = await action.execute({ recipeId: 'unknown' }, {
    callId: 'call-unknown',
    agent: { session: { header: { cwd: workspaceRoot } } },
    signal: new AbortController().signal,
  }) as { status: string; reason?: string }
  assert.equal(result.status, 'denied')
  assert.match(result.reason ?? '', /recipe is not configured/)
  assert.equal(approvalCount, 0)
  assert.equal(spawnCount, 0)
})

test('controlled action tool denies without a host Goal and does not ask approval', async () => {
  const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'complete-repo')
  const recipe = {
    id: 'test',
    command: 'npm',
    args: ['test'],
    sandboxMode: 'read-only' as const,
    timeoutMs: 30_000,
    maxOutputBytes: 32_000,
    enabled: true,
  }
  let approvalCount = 0
  let spawnCount = 0
  const services: Record<string, unknown> = {
    goals: { get: () => ({ phase: 'active', activation: 'disarmed' }) },
    approval: { request: async () => { approvalCount += 1; return 'allowed-once' } },
    sandboxPolicy: { resolve: ({ mode }: { mode: 'read-only' | 'workspace-write' }) => ({ mode, workspaceRoot }) },
    sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }) },
    subprocess: { spawn: () => { spawnCount += 1; throw new Error('must not spawn') } },
  }
  const registered: HarnessTool[] = []
  apply({
    tools: { register: (tool) => registered.push(tool) },
    get: <T>(name: string) => services[name] as T | undefined,
  }, { workspaceRoot, controlledActions: { enabled: true, recipes: [recipe] } })
  const action = registered.find((tool) => tool.name === 'repo_atlas_controlled_action')
  assert.ok(action)
  const result = await action.execute({ recipeId: 'test' }, {
    callId: 'call-2',
    agent: { session: { header: { cwd: workspaceRoot } } },
    signal: new AbortController().signal,
  }) as { status: string; reason?: string }
  assert.equal(result.status, 'denied')
  assert.match(result.reason ?? '', /Goal/)
  assert.equal(approvalCount, 0)
  assert.equal(spawnCount, 0)
})
