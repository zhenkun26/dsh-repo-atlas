import { withJsonOutput } from './json-output.ts'
import type { ChangeProposalRequest } from '../types.ts'
import type { ChangeProposalCommitAuthorizer, ChangeProposalLandingAuthorizer, ChangeProposalVerificationRunner } from '../repository/change-proposal.ts'
import type { HarnessTool, HarnessToolExecution } from './public.ts'
import type { HarnessSessionRuntime, HarnessSessionRuntimeResolution } from './session-runtime.ts'

export function createChangeProposalTool(
  resolveRuntime: (execution: HarnessToolExecution | undefined) => HarnessSessionRuntimeResolution,
  createVerificationRunner: (runtime: HarnessSessionRuntime) => ChangeProposalVerificationRunner | undefined,
  commitAuthorizer?: ChangeProposalCommitAuthorizer,
  landingAuthorizer?: ChangeProposalLandingAuthorizer,
): HarnessTool {
  return withJsonOutput({
    name: 'repo_atlas_change_proposal',
    description: '查询、列举、实时检查、landing/release preflight、准备、审阅、导出、确认、拒绝或释放当前 session 的隔离代码变更提案；支持显式确认后将有界补丁应用到隔离 worktree、创建本地 detached-worktree commit，并可在 Harness 审批后 fast-forward 落地到 source workspace；不会解决冲突、访问 remote 或推送。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['prepare', 'inspect', 'list', 'history', 'inspect-recovery', 'inspect-live', 'inspect-landing', 'inspect-release', 'confirm', 'reject', 'release', 'prepare-patch', 'review-patch', 'export-patch', 'confirm-patch', 'reject-patch', 'verify-patch', 'prepare-commit', 'confirm-commit', 'reject-commit', 'prepare-landing', 'confirm-landing', 'reject-landing'] },
        sessionId: { type: 'string' },
        intent: { type: 'string' },
        targets: { type: 'array' },
        evidenceIds: { type: 'array' },
        proposalId: { type: 'string' },
        confirmationDigest: { type: 'string' },
        patchId: { type: 'string' },
        patchText: { type: 'string' },
        patchConfirmationDigest: { type: 'string' },
        verificationRecipeId: { type: 'string', description: '已配置的只读验证 recipe 标识' },
        commitId: { type: 'string' },
        commitConfirmationDigest: { type: 'string' },
        commitMessage: { type: 'string', description: '显式提供的 bounded、非 secret-like 本地 commit message' },
        landingId: { type: 'string' },
        landingConfirmationDigest: { type: 'string' },
        limit: { type: 'number', description: 'session-only proposal summary/history 数量上限，1 到 100；缺省为 50' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [{
        type: 'text',
        text: JSON.stringify(value, null, 2),
      }],
    },
    async execute(input: unknown, execution: HarnessToolExecution) {
      const resolved = resolveRuntime(execution)
      if (!resolved.ok) return { status: 'blocked', operationStatus: 'blocked', reason: resolved.reason }
      const request = proposalInput(input)
      if (resolved.runtime.analysis?.reader?.hostBacked === false && !['inspect', 'list', 'history', 'inspect-recovery'].includes(request.action)) {
        return { status: 'blocked', operationStatus: 'blocked', reason: 'local Git lifecycle requires a verified host-backed repository; provider analysis does not authorize host Git' }
      }
      const manager = resolved.runtime.proposalManager
      const verificationRunner = createVerificationRunner(resolved.runtime)
      const signal = resolved.execution.signal
      if (request.action === 'list') return manager.list({ limit: request.invalidLimit ? Number.NaN : request.limit })
      if (request.action === 'history') {
        if (!request.proposalId) return { status: 'blocked', reason: 'history requires proposalId', events: [], total: 0, returned: 0, truncated: false, sessionOnly: true }
        return manager.history({ proposalId: request.proposalId, limit: request.invalidLimit ? Number.NaN : request.limit })
      }
      if (request.action === 'inspect-recovery') {
        if (!request.proposalId) return { status: 'blocked', reason: 'inspect-recovery requires proposalId', sessionOnly: true }
        return manager.inspectRecovery(request.proposalId)
      }
      if (request.action === 'inspect-live') {
        if (!request.proposalId) return { status: 'blocked', operationStatus: 'blocked', reason: 'inspect-live requires proposalId' }
        return manager.inspectLive(request.proposalId, signal)
      }
      if (request.action === 'inspect-landing') {
        if (!request.proposalId) return { status: 'blocked', operationStatus: 'blocked', reason: 'inspect-landing requires proposalId' }
        return manager.inspectLanding(request.proposalId, signal)
      }
      if (request.action === 'inspect-release') {
        if (!request.proposalId) return { status: 'blocked', operationStatus: 'blocked', reason: 'inspect-release requires proposalId' }
        return manager.inspectRelease(request.proposalId, signal)
      }
      if (request.action === 'inspect') {
        if (!request.proposalId) return { status: 'blocked', operationStatus: 'blocked', reason: 'inspect requires proposalId' }
        return manager.inspect(request.proposalId)
      }
      if (request.action === 'prepare') {
        if (!request.request) return { status: 'blocked', operationStatus: 'blocked', reason: 'prepare requires sessionId, intent, and targets' }
        return manager.prepare(request.request, signal)
      }
      if (request.action === 'prepare-patch') {
        if (!request.proposalId || request.patchText === undefined) return { status: 'blocked', operationStatus: 'blocked', reason: 'prepare-patch requires proposalId and patchText' }
        return manager.preparePatch({ proposalId: request.proposalId, patchText: request.patchText }, signal)
      }
      if (request.action === 'review-patch') {
        if (!request.patchId) return { status: 'blocked', operationStatus: 'blocked', reason: 'review-patch requires patchId' }
        return manager.reviewPatch(request.patchId)
      }
      if (request.action === 'export-patch') {
        if (!request.patchId) return { status: 'blocked', operationStatus: 'blocked', reason: 'export-patch requires patchId' }
        return manager.exportPatch(request.patchId, request.patchConfirmationDigest ?? '')
      }
      if (request.action === 'confirm-patch') {
        if (!request.patchId) return { status: 'blocked', operationStatus: 'blocked', reason: 'confirm-patch requires patchId' }
        return manager.confirmPatch(request.patchId, request.patchConfirmationDigest ?? '', signal)
      }
      if (request.action === 'reject-patch') {
        if (!request.patchId) return { status: 'blocked', operationStatus: 'blocked', reason: 'reject-patch requires patchId' }
        return manager.rejectPatch(request.patchId)
      }
      if (request.action === 'verify-patch') {
        if (!request.patchId || !request.verificationRecipeId) return { status: 'blocked', operationStatus: 'blocked', reason: 'verify-patch requires patchId and verificationRecipeId' }
        return manager.verifyPatch({
          patchId: request.patchId,
          confirmationDigest: request.patchConfirmationDigest ?? '',
          recipeId: request.verificationRecipeId,
        }, verificationRunner, { callId: execution.callId, agent: execution.agent }, signal)
      }
      if (request.action === 'prepare-commit') {
        if (!request.proposalId || request.commitMessage === undefined) return { status: 'blocked', operationStatus: 'commit-blocked', reason: 'prepare-commit requires proposalId and commitMessage' }
        return manager.prepareCommit({ proposalId: request.proposalId, commitMessage: request.commitMessage }, signal)
      }
      if (request.action === 'confirm-commit') {
        if (!request.commitId) return { status: 'blocked', operationStatus: 'commit-blocked', reason: 'confirm-commit requires commitId' }
        return manager.confirmCommit(request.commitId, request.commitConfirmationDigest ?? '', commitAuthorizer, { callId: execution.callId, agent: execution.agent }, signal)
      }
      if (request.action === 'reject-commit') {
        if (!request.commitId) return { status: 'blocked', operationStatus: 'commit-blocked', reason: 'reject-commit requires commitId' }
        return manager.rejectCommit(request.commitId)
      }
      if (request.action === 'prepare-landing') {
        if (!request.proposalId) return { status: 'blocked', operationStatus: 'landing-blocked', reason: 'prepare-landing requires proposalId' }
        return manager.prepareLanding({ proposalId: request.proposalId }, signal)
      }
      if (request.action === 'confirm-landing') {
        if (!request.landingId) return { status: 'blocked', operationStatus: 'landing-blocked', reason: 'confirm-landing requires landingId' }
        return manager.confirmLanding(request.landingId, request.landingConfirmationDigest ?? '', landingAuthorizer, { callId: execution.callId, agent: execution.agent }, signal)
      }
      if (request.action === 'reject-landing') {
        if (!request.landingId) return { status: 'blocked', operationStatus: 'landing-blocked', reason: 'reject-landing requires landingId' }
        return manager.rejectLanding(request.landingId)
      }
      if (!request.proposalId) return { status: 'blocked', operationStatus: 'blocked', reason: `${request.action} requires proposalId` }
      if (request.action === 'confirm') return manager.confirm(request.proposalId, request.confirmationDigest ?? '', signal)
      if (request.action === 'reject') return manager.reject(request.proposalId)
      return manager.release(request.proposalId, signal)
    },
  })
}

function proposalInput(input: unknown): {
  action: 'prepare' | 'inspect' | 'list' | 'history' | 'inspect-recovery' | 'inspect-live' | 'inspect-landing' | 'inspect-release' | 'confirm' | 'reject' | 'release' | 'prepare-patch' | 'review-patch' | 'export-patch' | 'confirm-patch' | 'reject-patch' | 'verify-patch' | 'prepare-commit' | 'confirm-commit' | 'reject-commit' | 'prepare-landing' | 'confirm-landing' | 'reject-landing'
  request?: ChangeProposalRequest
  proposalId?: string
  confirmationDigest?: string
  patchId?: string
  patchText?: string
  patchConfirmationDigest?: string
  verificationRecipeId?: string
  commitId?: string
  commitConfirmationDigest?: string
  commitMessage?: string
  landingId?: string
  landingConfirmationDigest?: string
  limit?: number
  invalidLimit: boolean
} {
  if (!isRecord(input)) return { action: 'prepare', invalidLimit: false }
  const action = input.action === 'inspect' || input.action === 'list' || input.action === 'history' || input.action === 'inspect-recovery' || input.action === 'inspect-live' || input.action === 'inspect-landing' || input.action === 'inspect-release' || input.action === 'confirm' || input.action === 'reject' || input.action === 'release' || input.action === 'prepare-patch' || input.action === 'review-patch' || input.action === 'export-patch' || input.action === 'confirm-patch' || input.action === 'reject-patch' || input.action === 'verify-patch' || input.action === 'prepare-commit' || input.action === 'confirm-commit' || input.action === 'reject-commit' || input.action === 'prepare-landing' || input.action === 'confirm-landing' || input.action === 'reject-landing' ? input.action : 'prepare'
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
  const intent = typeof input.intent === 'string' ? input.intent : ''
  const targets = Array.isArray(input.targets) ? input.targets.flatMap(parseTarget) : []
  const evidenceIds = Array.isArray(input.evidenceIds) ? input.evidenceIds.filter((value): value is string => typeof value === 'string') : undefined
  const hasLimit = Object.prototype.hasOwnProperty.call(input, 'limit')
  return {
    action,
    request: action === 'prepare' ? { sessionId, intent, targets, evidenceIds } : undefined,
    proposalId: typeof input.proposalId === 'string' ? input.proposalId : undefined,
    confirmationDigest: typeof input.confirmationDigest === 'string' ? input.confirmationDigest : undefined,
    patchId: typeof input.patchId === 'string' ? input.patchId : undefined,
    patchText: typeof input.patchText === 'string' ? input.patchText : undefined,
    patchConfirmationDigest: typeof input.patchConfirmationDigest === 'string' ? input.patchConfirmationDigest : undefined,
    verificationRecipeId: typeof input.verificationRecipeId === 'string' ? input.verificationRecipeId : undefined,
    commitId: typeof input.commitId === 'string' ? input.commitId : undefined,
    commitConfirmationDigest: typeof input.commitConfirmationDigest === 'string' ? input.commitConfirmationDigest : undefined,
    commitMessage: typeof input.commitMessage === 'string' ? input.commitMessage : undefined,
    landingId: typeof input.landingId === 'string' ? input.landingId : undefined,
    landingConfirmationDigest: typeof input.landingConfirmationDigest === 'string' ? input.landingConfirmationDigest : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    invalidLimit: hasLimit && typeof input.limit !== 'number',
  }
}

function parseTarget(value: unknown): ChangeProposalRequest['targets'] {
  if (!isRecord(value) || typeof value.relativePath !== 'string') return []
  const operation = value.operation
  if (operation !== 'add' && operation !== 'modify' && operation !== 'delete') return []
  return [{
    relativePath: value.relativePath,
    operation,
    rationale: typeof value.rationale === 'string' ? value.rationale : undefined,
  }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
