import { createNodeGitWorktreeAdapter } from './git-worktree-adapter.ts'
export { createNodeGitWorktreeAdapter } from './git-worktree-adapter.ts'
import { PatchApplicationError, CommitOperationError, LandingOperationError, LandingInspectionError } from './change-proposal-errors.ts'
import {
  validateTargets,
  deriveRisks,
  createProposalDigest,
  sameDigest,
  isSafeGitRevision,
  validatePatch,
  createPatchDigest,
  createCommitDigest,
  createLandingDigest,
  samePathSet,
  clonePatchSummary,
  boundVerification,
  workspaceRelativeRoot,
  workspaceChangedPaths,
  repositoryRelativePaths,
  normalizeCommitMessage,
  boundedRedactedText,
  boundedList,
  redactError,
} from './change-proposal-format.ts'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { isWithin } from '../safety/path-policy.ts'
import type {
  AnalysisSession,
  ChangeProposal,
  ChangeProposalCommit,
  ChangeProposalCommitRequest,
  ChangeProposalCommitExecutionStatus,
  ChangeProposalEvent,
  ChangeProposalEventPhase,
  ChangeProposalHistoryRequest,
  ChangeProposalHistoryResult,
  ChangeProposalLanding,
  ChangeProposalLandingAssessment,
  ChangeProposalLandingRequest,
  ChangeProposalLandingExecutionStatus,
  ChangeProposalLandingRelation,
  ChangeProposalLandingInspectionStatus,
  ChangeProposalReleaseAssessment,
  ChangeProposalReleaseRelation,
  ChangeProposalLiveInspection,
  ChangeProposalLiveSourceObservation,
  ChangeProposalLiveWorktreeObservation,
  ChangeProposalListRequest,
  ChangeProposalListResult,
  ChangeProposalPatch,
  ChangeProposalPatchRequest,
  ChangeProposalPatchExport,
  ChangeProposalRequest,
  ChangeProposalRecoveryAction,
  ChangeProposalRecoveryRecommendation,
  ChangeProposalRecoveryResult,
  ChangeProposalResult,
  ChangeProposalSummary,
  ChangeProposalVerification,
  ChangeProposalVerifyPatchRequest,
  ChangeProposalWorktree,
  RepoAtlasConfig,
} from '../types.ts'

export interface ChangeProposalLimits {
  maxTargets: number
  maxEvidenceIds: number
  maxTextBytes: number
  maxHistoryEvents: number
  expirationMs: number
  maxPatchBytes: number
  maxPatchFiles: number
  maxPatchHunks: number
  maxPatchLineBytes: number
}

export const DEFAULT_CHANGE_PROPOSAL_LIMITS: ChangeProposalLimits = {
  maxTargets: 32,
  maxEvidenceIds: 64,
  maxTextBytes: 4_096,
  maxHistoryEvents: 128,
  expirationMs: 15 * 60 * 1_000,
  maxPatchBytes: 128 * 1_024,
  maxPatchFiles: 32,
  maxPatchHunks: 128,
  maxPatchLineBytes: 8 * 1_024,
}

export const DEFAULT_CHANGE_PROPOSAL_LIST_LIMIT = 50
export const MAX_CHANGE_PROPOSAL_LIST_LIMIT = 100

interface RepositoryRevision {
  repositoryRoot: string
  baseRevision: string
}

interface InspectedWorktree extends ChangeProposalWorktree {
  dirty: boolean
  changedPaths: string[]
}

interface InspectedSourceWorktree {
  path: string
  repositoryRoot: string
  revision: string
  dirty: boolean
}

export interface GitLandingInspection {
  source: InspectedSourceWorktree
  targetRevision: string
  sourceIsAncestor: boolean
  targetIsAncestor: boolean
}

export interface GitWorktreeAdapter {
  discover(workspaceRoot: string, signal?: AbortSignal): Promise<RepositoryRevision>
  create(repositoryRoot: string, baseRevision: string, signal?: AbortSignal): Promise<ChangeProposalWorktree>
  inspect(repositoryRoot: string, worktree: ChangeProposalWorktree, signal?: AbortSignal): Promise<InspectedWorktree>
  inspectSource(repositoryRoot: string, sourceWorkspaceRoot: string, signal?: AbortSignal): Promise<InspectedSourceWorktree>
  inspectLanding(repositoryRoot: string, sourceWorkspaceRoot: string, expectedSourceRevision: string, commitRevision: string, signal?: AbortSignal): Promise<GitLandingInspection>
  applyPatch(repositoryRoot: string, worktree: ChangeProposalWorktree, patchText: string, workspaceRelativeRoot: string, signal?: AbortSignal): Promise<void>
  commit(repositoryRoot: string, worktree: ChangeProposalWorktree, repositoryRelativePaths: readonly string[], commitMessage: string, signal?: AbortSignal): Promise<string>
  land(repositoryRoot: string, sourceWorkspaceRoot: string, expectedSourceRevision: string, commitRevision: string, signal?: AbortSignal): Promise<string>
  remove(repositoryRoot: string, worktree: ChangeProposalWorktree, signal?: AbortSignal): Promise<void>
}

export interface ChangeProposalVerificationExecution {
  callId?: string
  agent?: { session: { header?: { cwd?: string } } }
}

export interface ChangeProposalVerificationRunner {
  run(request: {
    recipeId: string
    worktree: ChangeProposalWorktree
    execution?: ChangeProposalVerificationExecution
    signal?: AbortSignal
  }): Promise<ChangeProposalVerification>
}

export interface ChangeProposalCommitExecution extends ChangeProposalVerificationExecution {}

export interface ChangeProposalCommitApproval {
  allowed: boolean
  auditId?: string
  reason: string
}

export interface ChangeProposalCommitAuthorizer {
  authorize(request: {
    commitId: string
    confirmationDigest: string
    commitMessage: string
    worktree: ChangeProposalWorktree
    execution?: ChangeProposalCommitExecution
    signal?: AbortSignal
  }): Promise<ChangeProposalCommitApproval>
}

export interface ChangeProposalLandingExecution extends ChangeProposalVerificationExecution {}

export interface ChangeProposalLandingApproval {
  allowed: boolean
  auditId?: string
  reason: string
}

export interface ChangeProposalLandingAuthorizer {
  authorize(request: {
    landingId: string
    confirmationDigest: string
    sourcePath: string
    commitRevision: string
    execution?: ChangeProposalLandingExecution
    signal?: AbortSignal
  }): Promise<ChangeProposalLandingApproval>
}

interface StoredPatchDraft {
  proposalId: string
  patchText: string
  patch: ChangeProposalPatch
}

interface StoredCommitDraft {
  proposalId: string
  commit: ChangeProposalCommit
}

interface StoredLandingDraft {
  proposalId: string
  landing: ChangeProposalLanding
}

type ChangeProposalEventRecorder = (phase: ChangeProposalEventPhase, reason: string) => void

const proposalEventRecorders = new WeakMap<ChangeProposal, ChangeProposalEventRecorder>()

export interface ChangeProposalManagerOptions {
  adapter?: GitWorktreeAdapter
  limits?: Partial<ChangeProposalLimits>
}

export class ChangeProposalManager {
  private readonly sessions = new Map<string, AnalysisSession>()
  private readonly proposals = new Map<string, ChangeProposal>()
  private readonly histories = new Map<string, ChangeProposalEvent[]>()
  private readonly patches = new Map<string, StoredPatchDraft>()
  private readonly commits = new Map<string, StoredCommitDraft>()
  private readonly landings = new Map<string, StoredLandingDraft>()
  private readonly config: RepoAtlasConfig
  private readonly adapter: GitWorktreeAdapter
  private readonly limits: ChangeProposalLimits

  constructor(config: RepoAtlasConfig, options: ChangeProposalManagerOptions = {}) {
    this.config = config
    this.adapter = options.adapter ?? createNodeGitWorktreeAdapter()
    this.limits = {
      ...DEFAULT_CHANGE_PROPOSAL_LIMITS,
      ...options.limits,
    }
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
    }
  }

  registerSession(session: AnalysisSession): void {
    if (session.workspaceRoot !== this.config.workspaceRoot) return
    this.sessions.set(session.sessionId, session)
  }

  inspect(proposalId: string): ChangeProposalResult {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    return resultFor(proposal, 'session-only proposal lifecycle snapshot returned; live workspace and Git state were not inspected')
  }

  async inspectLive(proposalId: string, signal?: AbortSignal): Promise<ChangeProposalResult> {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (signal?.aborted) {
      return resultForWithLive(proposal, 'live inspection was interrupted before adapter access', interruptedLiveInspection(proposal, this.limits.maxTextBytes))
    }

    let source: ChangeProposalLiveSourceObservation
    try {
      const inspected = await this.adapter.inspectSource(proposal.repositoryRoot, proposal.workspaceRoot, signal)
      source = {
        status: 'available',
        reason: 'source workspace was inspected read-only',
        clean: !inspected.dirty,
        revision: inspected.revision,
        baseRevisionMatches: inspected.revision === proposal.baseRevision,
        repositoryRootMatches: path.resolve(inspected.repositoryRoot) === path.resolve(proposal.repositoryRoot),
        workspacePathMatches: path.resolve(inspected.path) === path.resolve(proposal.workspaceRoot),
      }
    } catch (error) {
      source = { status: 'unknown', reason: boundedRedactedText(`source workspace inspection failed: ${redactError(error)}`, this.limits.maxTextBytes) }
    }

    let worktree: ChangeProposalLiveWorktreeObservation
    if (!proposal.worktree) {
      worktree = { status: 'not-applicable', reason: 'proposal has no managed worktree to inspect' }
    } else {
      try {
        const inspected = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
        worktree = {
          status: 'available',
          reason: 'session-owned worktree was inspected read-only',
          clean: !inspected.dirty,
          baseRevision: inspected.baseRevision,
          baseRevisionMatches: inspected.baseRevision === proposal.baseRevision,
          identityMatches: inspected.identity === proposal.worktree.identity,
          changedPathCount: inspected.changedPaths.length,
        }
      } catch (error) {
        worktree = { status: 'unknown', reason: boundedRedactedText(`managed worktree inspection failed: ${redactError(error)}`, this.limits.maxTextBytes) }
      }
    }

    const live = createLiveInspection(source, worktree)
    return resultForWithLive(proposal, live.reason, live)
  }

  async inspectLanding(proposalId: string, signal?: AbortSignal): Promise<ChangeProposalResult> {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (!proposal.commit || proposal.commit.status !== 'created' || proposal.commit.executionStatus !== 'commit-created' || !proposal.commit.revision) {
      const assessment = createLandingAssessment('not-applicable', 'not-applicable', 'landing preflight requires a created local commit with a known revision')
      return resultForWithLandingAssessment(proposal, assessment.reason, assessment)
    }
    if (!isSafeGitRevision(proposal.baseRevision) || !isSafeGitRevision(proposal.commit.revision)) {
      const assessment = createLandingAssessment('unknown', 'unknown', 'landing preflight revisions are not safe Git revisions')
      return resultForWithLandingAssessment(proposal, assessment.reason, assessment)
    }
    if (signal?.aborted) {
      const assessment = createLandingAssessment('unknown', 'unknown', 'landing preflight was interrupted before adapter access')
      return resultForWithLandingAssessment(proposal, assessment.reason, assessment)
    }

    let inspected: GitLandingInspection
    try {
      inspected = await this.adapter.inspectLanding(proposal.repositoryRoot, proposal.workspaceRoot, proposal.baseRevision, proposal.commit.revision, signal)
    } catch (error) {
      const relation: ChangeProposalLandingRelation = isTargetUnavailableInspection(error) ? 'target-unavailable' : 'unknown'
      const assessment = createLandingAssessment('unknown', relation, boundedRedactedText(`landing preflight inspection failed: ${redactError(error)}`, this.limits.maxTextBytes))
      return resultForWithLandingAssessment(proposal, assessment.reason, assessment)
    }

    const source = inspected.source
    const repositoryRootMatches = path.resolve(source.repositoryRoot) === path.resolve(proposal.repositoryRoot)
    const workspacePathMatches = path.resolve(source.path) === path.resolve(proposal.workspaceRoot)
    const common = {
      sourceRevision: source.revision,
      targetRevision: inspected.targetRevision,
      clean: !source.dirty,
      baseRevisionMatches: source.revision === proposal.baseRevision,
      repositoryRootMatches,
      workspacePathMatches,
    }
    let relation: ChangeProposalLandingRelation
    let reason: string
    if (!repositoryRootMatches || !workspacePathMatches) {
      relation = 'unknown'
      reason = 'landing preflight could not prove the recorded source repository and workspace identity'
    } else if (source.dirty) {
      relation = 'source-dirty'
      reason = 'source workspace is dirty; landing was not performed'
    } else if (source.revision === inspected.targetRevision) {
      relation = 'already-landed'
      reason = 'source workspace is already at the session-created commit; landing was not performed'
    } else if (inspected.targetIsAncestor) {
      relation = 'source-ahead'
      reason = source.revision === proposal.baseRevision
        ? 'source workspace is ahead of the session-created commit; landing was not performed'
        : 'source workspace is ahead of the session-created commit and has drifted from the proposal base; landing was not performed'
    } else if (source.revision !== proposal.baseRevision) {
      relation = 'source-revision-drift'
      reason = 'source workspace revision differs from the proposal base; landing was not performed'
    } else if (inspected.sourceIsAncestor) {
      relation = 'fast-forwardable'
      reason = 'source workspace is a clean ancestor of the session-created commit; landing was not performed'
    } else {
      relation = 'diverged'
      reason = 'source workspace and the session-created commit have diverged; landing was not performed'
    }
    const assessment = {
      ...createLandingAssessment('available', relation, reason),
      ...common,
    }
    return resultForWithLandingAssessment(proposal, assessment.reason, assessment)
  }

  async inspectRelease(proposalId: string, signal?: AbortSignal): Promise<ChangeProposalResult> {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (!proposal.worktree) {
      const assessment = createReleaseAssessment('not-applicable', 'not-applicable', 'release readiness requires a session-owned worktree')
      return resultForWithReleaseAssessment(proposal, assessment.reason, assessment)
    }
    if (proposal.status !== 'confirmed') {
      const assessment = createReleaseAssessment('available', 'proposal-state-blocked', 'release readiness is blocked because the proposal is not in the confirmed state')
      return resultForWithReleaseAssessment(proposal, assessment.reason, assessment)
    }
    if (signal?.aborted) {
      const assessment = createReleaseAssessment('unknown', 'unknown', 'release readiness inspection was interrupted before adapter access')
      return resultForWithReleaseAssessment(proposal, assessment.reason, assessment)
    }

    let inspected: InspectedWorktree
    try {
      inspected = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      const assessment = createReleaseAssessment('unknown', 'unknown', boundedRedactedText(`release readiness inspection failed: ${redactError(error)}`, this.limits.maxTextBytes))
      return resultForWithReleaseAssessment(proposal, assessment.reason, assessment)
    }

    const identityMatches = inspected.identity === proposal.worktree.identity
    const common = { clean: !inspected.dirty, identityMatches }
    let relation: ChangeProposalReleaseRelation
    let reason: string
    if (!identityMatches) {
      relation = 'identity-mismatch'
      reason = 'managed worktree identity no longer matches the session-owned worktree; release was not performed'
    } else if (inspected.dirty) {
      relation = 'worktree-dirty'
      reason = 'session-owned worktree is dirty; release was not performed'
    } else {
      relation = 'ready'
      reason = 'session-owned worktree is clean and identity-matched; release was not performed'
    }
    const assessment = {
      ...createReleaseAssessment('available', relation, reason),
      ...common,
    }
    return resultForWithReleaseAssessment(proposal, assessment.reason, assessment)
  }

  list(request: ChangeProposalListRequest = {}): ChangeProposalListResult {
    const limit = normalizeProposalListLimit(request.limit)
    if (limit === undefined) return blockedProposalList('proposal list limit must be a positive safe integer no greater than 100')
    const ordered = [...this.proposals.values()].sort(compareProposalCreation)
    const proposals = ordered.slice(0, limit).map(proposalSummary)
    return {
      status: 'available',
      reason: 'session-only proposal summaries returned; live workspace and Git state were not inspected',
      proposals,
      total: ordered.length,
      returned: proposals.length,
      truncated: ordered.length > limit,
      sessionOnly: true,
    }
  }

  history(request: ChangeProposalHistoryRequest): ChangeProposalHistoryResult {
    const limit = normalizeProposalListLimit(request.limit)
    if (limit === undefined) return blockedProposalHistory('proposal history limit must be a positive safe integer no greater than 100')
    const proposal = this.proposals.get(request.proposalId)
    if (!proposal) return blockedProposalHistory('proposal is unknown to the current session')
    const retained = this.histories.get(proposal.proposalId) ?? []
    const events = retained.slice(Math.max(0, retained.length - limit)).map(cloneProposalEvent)
    return {
      status: 'available',
      reason: 'session-only lifecycle events returned; live workspace and Git state were not inspected',
      proposalId: proposal.proposalId,
      events,
      total: retained.length,
      returned: events.length,
      truncated: retained.length > limit,
      sessionOnly: true,
    }
  }

  inspectRecovery(proposalId: string): ChangeProposalRecoveryResult {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedProposalRecovery('proposal is unknown to the current session')
    const decision = recoveryDecision(proposal)
    return {
      status: 'available',
      reason: 'session-only recovery guidance returned; no lifecycle or live Git state was changed',
      guidance: {
        proposalId: proposal.proposalId,
        proposal: proposalSummary(proposal),
        recommendation: decision.recommendation,
        allowedActions: [...decision.allowedActions],
        manualReviewRequired: decision.manualReviewRequired,
        reason: boundedRedactedText(decision.reason, this.limits.maxTextBytes),
        sessionOnly: true,
      },
      sessionOnly: true,
    }
  }

  async prepare(request: ChangeProposalRequest, signal?: AbortSignal): Promise<ChangeProposalResult> {
    if (signal?.aborted) return blockedResult('interrupted', 'proposal preparation was interrupted before validation')
    const session = this.sessions.get(request.sessionId)
    if (!session) return blockedResult('blocked', 'the requested analysis session is not available in this session')
    if (session.reader?.hostBacked === false) return blockedResult('blocked', 'provider evidence has no verified host mapping for local Git operations')
    if (!session.goal.confirmed) return blockedResult('blocked', 'a confirmed GoalSpec is required before preparing a change proposal')
    if (!request.intent.trim()) return blockedResult('blocked', 'a user-supplied change intent is required')
    if (!Array.isArray(request.targets) || request.targets.length === 0) return blockedResult('blocked', 'at least one target operation is required')

    let revision: RepositoryRevision
    try {
      revision = await this.adapter.discover(session.workspaceRoot, signal)
    } catch (error) {
      return blockedResult(signal?.aborted ? 'interrupted' : 'blocked', `local Git revision discovery failed: ${redactError(error)}`)
    }
    if (!isWithin(revision.repositoryRoot, session.workspaceRoot)) {
      return blockedResult('blocked', 'the confirmed workspace is not contained by its Git repository root')
    }

    const validation = validateTargets(request.targets, session, this.config, this.limits)
    if (!validation.targets.some((target) => target.status === 'confirmed')) {
      return blockedResult('blocked', validation.limitations[0] ?? 'no target operation is within the confirmed scope')
    }
    const evidenceIds = [...new Set((request.evidenceIds ?? []).filter((id) => session.evidence.some((item) => item.evidenceId === id)))].slice(0, this.limits.maxEvidenceIds)
    const unknownEvidenceCount = (request.evidenceIds ?? []).filter((id) => !session.evidence.some((item) => item.evidenceId === id)).length
    const limitations = [...validation.limitations]
    if (unknownEvidenceCount) limitations.push(`${unknownEvidenceCount} evidence id(s) were not found in the confirmed session`)
    const intent = boundedRedactedText(request.intent, this.limits.maxTextBytes)
    const proposal: ChangeProposal = {
      proposalId: `proposal-${randomUUID()}`,
      sessionId: session.sessionId,
      workspaceRoot: session.workspaceRoot,
      repositoryRoot: revision.repositoryRoot,
      baseRevision: revision.baseRevision,
      intent,
      targets: validation.targets,
      evidenceIds,
      limitations: boundedList(limitations, this.limits.maxTextBytes),
      risks: boundedList(deriveRisks(validation.targets), this.limits.maxTextBytes),
      confirmationDigest: '',
      status: 'awaiting-confirmation',
      operationStatus: 'proposal',
      expiresAt: new Date(Date.now() + this.limits.expirationMs).toISOString(),
      executionStatus: {
        patch: 'patch-not-applied',
        commit: 'commit-not-created',
        landing: 'landing-not-performed',
        push: 'push-not-performed',
      },
      patchApplied: false,
      commitCreated: false,
      sourceLanded: false,
      pushPerformed: false,
      createdAt: new Date().toISOString(),
    }
    proposal.confirmationDigest = createProposalDigest(proposal)
    this.proposals.set(proposal.proposalId, proposal)
    this.attachEventRecorder(proposal)
    recordProposalEvent(proposal, 'proposal', 'proposal prepared; explicit digest confirmation is required before worktree creation')
    return resultFor(proposal, 'proposal prepared; explicit digest confirmation is required before worktree creation')
  }

  private attachEventRecorder(proposal: ChangeProposal): void {
    const events: ChangeProposalEvent[] = []
    this.histories.set(proposal.proposalId, events)
    proposalEventRecorders.set(proposal, (phase, reason) => {
      events.push({
        eventId: `event-${randomUUID()}`,
        proposalId: proposal.proposalId,
        phase,
        status: proposal.status,
        operationStatus: proposal.operationStatus,
        executionStatus: { ...proposal.executionStatus },
        reason: boundedRedactedText(reason, this.limits.maxTextBytes),
        createdAt: new Date().toISOString(),
        sessionOnly: true,
      })
      while (events.length > this.limits.maxHistoryEvents) events.shift()
    })
  }

  async confirm(proposalId: string, confirmationDigest: string, signal?: AbortSignal): Promise<ChangeProposalResult> {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (proposal.status !== 'awaiting-confirmation') return resultFor(proposal, 'proposal is no longer awaiting confirmation')
    if (signal?.aborted) return mutateStatus(proposal, 'interrupted', 'blocked', 'proposal confirmation was interrupted before worktree creation')
    if (Date.now() >= Date.parse(proposal.expiresAt)) return mutateStatus(proposal, 'blocked', 'blocked', 'proposal confirmation window has expired')
    if (!sameDigest(proposal.confirmationDigest, confirmationDigest)) return resultFor(proposal, 'confirmation digest does not match the pending proposal')

    let currentRevision: RepositoryRevision
    try {
      currentRevision = await this.adapter.discover(proposal.workspaceRoot, signal)
    } catch (error) {
      return mutateStatus(proposal, signal?.aborted ? 'interrupted' : 'blocked', 'blocked', `local Git revision discovery failed: ${redactError(error)}`)
    }
    if (currentRevision.baseRevision !== proposal.baseRevision || path.resolve(currentRevision.repositoryRoot) !== path.resolve(proposal.repositoryRoot)) {
      return mutateStatus(proposal, 'blocked', 'blocked', 'the repository revision or root changed after proposal preparation')
    }
    try {
      const worktree = await this.adapter.create(currentRevision.repositoryRoot, proposal.baseRevision, signal)
      if (isWithin(proposal.workspaceRoot, worktree.path)) throw new Error('created worktree is inside the source workspace')
      proposal.worktree = worktree
      proposal.status = 'confirmed'
      proposal.operationStatus = 'worktree-created'
      recordProposalEvent(proposal, 'proposal', 'isolated worktree created; patch, commit, and push were not performed')
      return resultFor(proposal, 'isolated worktree created; patch, commit, and push were not performed')
    } catch (error) {
      return mutateStatus(proposal, signal?.aborted ? 'interrupted' : 'blocked', 'blocked', `isolated worktree creation failed: ${redactError(error)}`)
    }
  }

  async preparePatch(request: ChangeProposalPatchRequest, signal?: AbortSignal): Promise<ChangeProposalResult> {
    if (signal?.aborted) return blockedResult('interrupted', 'patch preparation was interrupted before validation')
    const proposal = this.proposals.get(request.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (proposal.status !== 'confirmed' || !proposal.worktree) return resultFor(proposal, 'patches require a confirmed proposal with a managed worktree')
    if (proposal.patch) return resultFor(proposal, 'this proposal already has a patch draft; terminal patch states are not replayable')
    const session = this.sessions.get(proposal.sessionId)
    if (!session) return resultFor(proposal, 'the analysis session for this proposal is no longer available')
    let inspected: InspectedWorktree
    try {
      inspected = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      return resultFor(proposal, `patch worktree inspection failed: ${redactError(error)}`)
    }
    if (inspected.identity !== proposal.worktree.identity) return resultFor(proposal, 'worktree identity no longer matches the session-owned worktree')
    if (inspected.baseRevision !== proposal.baseRevision) return resultFor(proposal, 'worktree base revision no longer matches the proposal')
    if (inspected.dirty || inspected.changedPaths.length > 0) return resultFor(proposal, 'patch preparation requires a clean worktree')

    const validation = validatePatch(request.patchText, proposal, session, this.config, this.limits)
    if (!validation.parsed) return resultFor(proposal, validation.reason)
    const patch: ChangeProposalPatch = {
      patchId: `patch-${randomUUID()}`,
      confirmationDigest: '',
      status: 'awaiting-confirmation',
      summary: validation.parsed.summary,
      limitations: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.limits.expirationMs).toISOString(),
      executionStatus: 'patch-not-applied',
      verificationStatus: 'not-run',
    }
    patch.confirmationDigest = createPatchDigest(proposal, patch, validation.parsed.canonicalText)
    proposal.patch = patch
    proposal.operationStatus = 'patch-awaiting-confirmation'
    this.patches.set(patch.patchId, { proposalId: proposal.proposalId, patchText: validation.parsed.canonicalText, patch })
    recordProposalEvent(proposal, 'patch', 'patch draft prepared; exact patch digest confirmation is required before application')
    return resultFor(proposal, 'patch draft prepared; exact patch digest confirmation is required before application')
  }

  reviewPatch(patchId: string): ChangeProposalResult {
    const draft = this.patches.get(patchId)
    if (!draft) return blockedResult('blocked', 'patch draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this patch draft is no longer available')
    return resultFor(proposal, 'patch review descriptor returned; no files were modified')
  }

  exportPatch(patchId: string, confirmationDigest: string): ChangeProposalResult {
    const draft = this.patches.get(patchId)
    if (!draft) return blockedResult('blocked', 'patch draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this patch draft is no longer available')
    if (!sameDigest(draft.patch.confirmationDigest, confirmationDigest)) return resultFor(proposal, 'patch export digest does not match the canonical draft')
    if (draft.patch.status === 'awaiting-confirmation' && Date.now() >= Date.parse(draft.patch.expiresAt)) {
      return updatePatchFailure(proposal, draft.patch, 'blocked', 'patch export window has expired')
    }
    if (draft.patch.status !== 'awaiting-confirmation' && draft.patch.status !== 'applied') {
      return resultFor(proposal, 'only an awaiting-confirmation or applied patch can be exported')
    }
    if (proposal.status !== 'confirmed' || !proposal.worktree) return resultFor(proposal, 'patch export requires the confirmed session-owned proposal worktree')
    const patchExport: ChangeProposalPatchExport = {
      patchId: draft.patch.patchId,
      proposalId: proposal.proposalId,
      confirmationDigest: draft.patch.confirmationDigest,
      patchText: draft.patchText,
      summary: clonePatchSummary(draft.patch.summary),
      sessionOnly: true,
      exportedAt: new Date().toISOString(),
    }
    return { ...resultFor(proposal, 'canonical patch exported in the current session only'), patchExport }
  }

  async confirmPatch(patchId: string, confirmationDigest: string, signal?: AbortSignal): Promise<ChangeProposalResult> {
    const draft = this.patches.get(patchId)
    if (!draft) return blockedResult('blocked', 'patch draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this patch draft is no longer available')
    if (draft.patch.status !== 'awaiting-confirmation') return resultFor(proposal, 'patch draft is no longer awaiting confirmation')
    if (signal?.aborted) return updatePatchFailure(proposal, draft.patch, 'interrupted', 'patch confirmation was interrupted before application')
    if (Date.now() >= Date.parse(draft.patch.expiresAt)) return updatePatchFailure(proposal, draft.patch, 'blocked', 'patch confirmation window has expired')
    if (!sameDigest(draft.patch.confirmationDigest, confirmationDigest)) return resultFor(proposal, 'patch confirmation digest does not match the pending draft')
    if (proposal.status !== 'confirmed' || !proposal.worktree) return updatePatchFailure(proposal, draft.patch, 'blocked', 'the proposal worktree is no longer available for patch application')

    let inspected: InspectedWorktree
    try {
      inspected = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      return updatePatchFailure(proposal, draft.patch, signal?.aborted ? 'interrupted' : 'blocked', `live patch worktree inspection failed: ${redactError(error)}`)
    }
    if (inspected.identity !== proposal.worktree.identity) return updatePatchFailure(proposal, draft.patch, 'blocked', 'worktree identity no longer matches the session-owned worktree')
    if (inspected.baseRevision !== proposal.baseRevision) return updatePatchFailure(proposal, draft.patch, 'blocked', 'worktree base revision no longer matches the proposal')
    if (inspected.dirty || inspected.changedPaths.length > 0) return updatePatchFailure(proposal, draft.patch, 'blocked', 'patch application requires a clean worktree')

    try {
      await this.adapter.applyPatch(proposal.repositoryRoot, proposal.worktree, draft.patchText, workspaceRelativeRoot(proposal), signal)
    } catch (error) {
      const uncertain = error instanceof PatchApplicationError && error.uncertain
      draft.patch.status = signal?.aborted ? 'interrupted' : 'blocked'
      draft.patch.executionStatus = uncertain ? 'patch-application-unknown' : 'patch-not-applied'
      proposal.executionStatus.patch = draft.patch.executionStatus
      proposal.operationStatus = 'blocked'
      const reason = `isolated patch application failed${uncertain ? '; application result is unknown and the worktree was retained' : ''}: ${redactError(error)}`
      recordProposalEvent(proposal, 'patch', reason)
      return resultFor(proposal, reason)
    }

    let after: InspectedWorktree
    try {
      after = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      return updatePatchFailure(proposal, draft.patch, signal?.aborted ? 'interrupted' : 'blocked', `patch postcondition inspection failed; application result is unknown and the worktree was retained: ${redactError(error)}`, 'patch-application-unknown')
    }
    const changedPaths = workspaceChangedPaths(proposal, after)
    const expectedPaths = new Set(draft.patch.summary.files.map((file) => file.relativePath))
    if (!changedPaths.length || changedPaths.some((changedPath) => !expectedPaths.has(changedPath))) {
      return updatePatchFailure(proposal, draft.patch, 'blocked', 'patch postcondition did not prove that only declared targets changed; the worktree was retained', 'patch-application-unknown')
    }
    draft.patch.status = 'applied'
    draft.patch.executionStatus = 'patch-applied'
    proposal.executionStatus.patch = 'patch-applied'
    proposal.operationStatus = 'patch-applied'
    proposal.patchApplied = true
    recordProposalEvent(proposal, 'patch', 'patch applied to the isolated worktree; commit and push were not performed')
    return resultFor(proposal, 'patch applied to the isolated worktree; commit and push were not performed')
  }

  rejectPatch(patchId: string): ChangeProposalResult {
    const draft = this.patches.get(patchId)
    if (!draft) return blockedResult('blocked', 'patch draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this patch draft is no longer available')
    if (draft.patch.status !== 'awaiting-confirmation') return resultFor(proposal, 'patch draft is no longer awaiting confirmation')
    draft.patch.status = 'rejected'
    proposal.operationStatus = 'patch-rejected'
    recordProposalEvent(proposal, 'patch', 'patch draft rejected; no files were modified')
    return resultFor(proposal, 'patch draft rejected; no files were modified')
  }

  async verifyPatch(
    request: ChangeProposalVerifyPatchRequest,
    runner: ChangeProposalVerificationRunner | undefined,
    execution?: ChangeProposalVerificationExecution,
    signal?: AbortSignal,
  ): Promise<ChangeProposalResult> {
    const draft = this.patches.get(request.patchId)
    if (!draft) return blockedResult('blocked', 'patch draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this patch draft is no longer available')
    if (draft.patch.verificationStatus !== 'not-run' && draft.patch.verification) return resultForWithVerification(proposal, 'patch verification already has a terminal result', draft.patch.verification)
    if (!sameDigest(draft.patch.confirmationDigest, request.confirmationDigest)) return resultFor(proposal, 'patch verification digest does not match the canonical draft')
    if (draft.patch.status !== 'applied' || proposal.status !== 'confirmed' || !proposal.worktree) return resultFor(proposal, 'patch verification requires an applied patch in a confirmed session-owned worktree')
    if (!runner) return recordVerification(proposal, draft.patch, unavailableVerification(request.recipeId, proposal.worktree.identity, 'patch verification runner is unavailable'))
    if (signal?.aborted) return recordVerification(proposal, draft.patch, unavailableVerification(request.recipeId, proposal.worktree.identity, 'patch verification was interrupted before execution', 'interrupted'))

    let before: InspectedWorktree
    try {
      before = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      return recordVerification(proposal, draft.patch, unavailableVerification(request.recipeId, proposal.worktree.identity, `patch verification precondition inspection failed: ${redactError(error)}`, signal?.aborted ? 'interrupted' : 'blocked'))
    }
    const expectedPaths = new Set(draft.patch.summary.files.map((file) => file.relativePath))
    if (before.identity !== proposal.worktree.identity || before.baseRevision !== proposal.baseRevision || !before.dirty || !before.changedPaths.length || before.changedPaths.some((changedPath) => !expectedPaths.has(changedPath))) {
      return recordVerification(proposal, draft.patch, unavailableVerification(request.recipeId, proposal.worktree.identity, 'patch verification preconditions no longer match the applied patch', 'blocked'))
    }

    let verification: ChangeProposalVerification
    try {
      verification = await runner.run({ recipeId: request.recipeId, worktree: proposal.worktree, execution, signal })
    } catch (error) {
      verification = unavailableVerification(request.recipeId, proposal.worktree.identity, `patch verification runner failed closed: ${redactError(error)}`, signal?.aborted ? 'interrupted' : 'blocked')
    }
    verification = boundVerification(verification, this.limits.maxTextBytes)
    try {
      const after = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
      if (after.identity !== proposal.worktree.identity || after.baseRevision !== proposal.baseRevision || after.changedPaths.some((changedPath) => !expectedPaths.has(changedPath)) || !samePathSet(before.changedPaths, after.changedPaths)) {
        verification = { ...verification, status: 'blocked', reason: 'verification postcondition found an identity, revision, or path change outside the applied patch' }
      }
    } catch (error) {
      verification = { ...verification, status: signal?.aborted ? 'interrupted' : 'blocked', reason: `patch verification postcondition is unknown; worktree was retained: ${redactError(error)}` }
    }
    return recordVerification(proposal, draft.patch, verification)
  }

  async prepareCommit(request: ChangeProposalCommitRequest, signal?: AbortSignal): Promise<ChangeProposalResult> {
    if (signal?.aborted) return blockedResult('interrupted', 'commit preparation was interrupted before validation')
    const proposal = this.proposals.get(request.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (proposal.commit) return resultForWithCommit(proposal, 'this proposal already has a commit draft; terminal commit states are not replayable', proposal.commit)
    if (proposal.status !== 'confirmed' || !proposal.worktree) return resultFor(proposal, 'commit preparation requires a confirmed proposal with a managed worktree')
    if (!proposal.patch || proposal.patch.status !== 'applied' || proposal.patch.verificationStatus !== 'passed' || proposal.patch.verification?.status !== 'passed') {
      return resultFor(proposal, 'commit preparation requires an applied patch with passed verification')
    }

    let inspected: InspectedWorktree
    try {
      inspected = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      return resultFor(proposal, `commit worktree inspection failed: ${redactError(error)}`)
    }
    const expectedPaths = proposal.patch.summary.files.map((file) => file.relativePath)
    if (inspected.identity !== proposal.worktree.identity) return resultFor(proposal, 'worktree identity no longer matches the session-owned worktree')
    if (inspected.baseRevision !== proposal.baseRevision) return resultFor(proposal, 'worktree base revision no longer matches the proposal')
    let changedPaths: string[]
    try {
      changedPaths = workspaceChangedPaths(proposal, inspected)
    } catch (error) {
      return resultFor(proposal, `commit worktree path mapping failed: ${redactError(error)}`)
    }
    if (!inspected.dirty || !samePathSet(changedPaths, expectedPaths)) return resultFor(proposal, 'commit preparation requires exactly the applied patch paths in the worktree')

    const message = normalizeCommitMessage(request.commitMessage, this.limits.maxTextBytes)
    if (!message.value) return resultFor(proposal, message.reason)
    try {
      repositoryRelativePaths(proposal)
    } catch (error) {
      return resultFor(proposal, `commit paths are outside the repository: ${redactError(error)}`)
    }

    const commit: ChangeProposalCommit = {
      commitId: `commit-${randomUUID()}`,
      confirmationDigest: '',
      status: 'awaiting-confirmation',
      message: message.value,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.limits.expirationMs).toISOString(),
      executionStatus: 'commit-not-created',
    }
    commit.confirmationDigest = createCommitDigest(proposal, commit, expectedPaths)
    proposal.commit = commit
    proposal.operationStatus = 'commit-awaiting-confirmation'
    this.commits.set(commit.commitId, { proposalId: proposal.proposalId, commit })
    recordProposalEvent(proposal, 'commit', 'commit draft prepared; exact commit digest and host approval are required before local commit')
    return resultForWithCommit(proposal, 'commit draft prepared; exact commit digest and host approval are required before local commit', commit)
  }

  async confirmCommit(
    commitId: string,
    confirmationDigest: string,
    authorizer: ChangeProposalCommitAuthorizer | undefined,
    execution?: ChangeProposalCommitExecution,
    signal?: AbortSignal,
  ): Promise<ChangeProposalResult> {
    const draft = this.commits.get(commitId)
    if (!draft) return blockedResult('blocked', 'commit draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this commit draft is no longer available')
    if (draft.commit.status !== 'awaiting-confirmation') return resultForWithCommit(proposal, 'commit draft is no longer awaiting confirmation', draft.commit)
    if (signal?.aborted) return updateCommitFailure(proposal, draft.commit, 'interrupted', 'commit confirmation was interrupted before approval', 'commit-not-created')
    if (Date.now() >= Date.parse(draft.commit.expiresAt)) return updateCommitFailure(proposal, draft.commit, 'blocked', 'commit confirmation window has expired', 'commit-not-created')
    if (!sameDigest(draft.commit.confirmationDigest, confirmationDigest)) return resultForWithCommit(proposal, 'commit confirmation digest does not match the pending draft', draft.commit)
    if (proposal.status !== 'confirmed' || !proposal.worktree || !proposal.patch || proposal.patch.status !== 'applied' || proposal.patch.verificationStatus !== 'passed' || proposal.patch.verification?.status !== 'passed') {
      return updateCommitFailure(proposal, draft.commit, 'blocked', 'commit requires a confirmed proposal with an applied, passed-verified patch', 'commit-not-created')
    }

    let inspected: InspectedWorktree
    try {
      inspected = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      return updateCommitFailure(proposal, draft.commit, 'blocked', `live commit worktree inspection failed: ${redactError(error)}`, 'commit-not-created')
    }
    const expectedPaths = proposal.patch.summary.files.map((file) => file.relativePath)
    let changedPaths: string[]
    try {
      changedPaths = workspaceChangedPaths(proposal, inspected)
    } catch (error) {
      return updateCommitFailure(proposal, draft.commit, 'blocked', `commit worktree path mapping failed: ${redactError(error)}`, 'commit-not-created')
    }
    if (inspected.identity !== proposal.worktree.identity || inspected.baseRevision !== proposal.baseRevision || !inspected.dirty || !samePathSet(changedPaths, expectedPaths)) {
      return updateCommitFailure(proposal, draft.commit, 'blocked', 'commit preconditions no longer match the applied patch', 'commit-not-created')
    }
    let paths: string[]
    try {
      paths = repositoryRelativePaths(proposal)
    } catch (error) {
      return updateCommitFailure(proposal, draft.commit, 'blocked', `commit paths are outside the repository: ${redactError(error)}`, 'commit-not-created')
    }
    if (!authorizer) return updateCommitFailure(proposal, draft.commit, 'blocked', 'commit approval capability is unavailable', 'commit-not-created')

    let approval: ChangeProposalCommitApproval
    try {
      approval = await authorizer.authorize({
        commitId: draft.commit.commitId,
        confirmationDigest: draft.commit.confirmationDigest,
        commitMessage: draft.commit.message,
        worktree: proposal.worktree,
        execution,
        signal,
      })
    } catch (error) {
      return resultForWithCommit(proposal, `commit approval failed closed: ${redactError(error)}`, draft.commit)
    }
    if (!approval.allowed) return resultForWithCommit(proposal, approval.reason || 'commit approval was rejected; the draft remains awaiting confirmation', draft.commit)
    if (!approval.auditId) return updateCommitFailure(proposal, draft.commit, 'blocked', 'commit approval did not provide an audit id', 'commit-not-created')
    draft.commit.approvalAuditId = boundedRedactedText(approval.auditId, this.limits.maxTextBytes)

    let revision: string
    try {
      revision = await this.adapter.commit(proposal.repositoryRoot, proposal.worktree, paths, draft.commit.message, signal)
    } catch (error) {
      const uncertain = error instanceof CommitOperationError && error.uncertain
      return updateCommitFailure(
        proposal,
        draft.commit,
        signal?.aborted ? 'interrupted' : 'blocked',
        `isolated commit failed${uncertain ? '; commit result is unknown and the worktree was retained' : ''}: ${redactError(error)}`,
        uncertain ? 'commit-creation-unknown' : 'commit-not-created',
      )
    }

    let after: InspectedWorktree
    try {
      after = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
    } catch (error) {
      return updateCommitFailure(proposal, draft.commit, signal?.aborted ? 'interrupted' : 'blocked', `commit postcondition inspection failed; result is unknown and the worktree was retained: ${redactError(error)}`, 'commit-creation-unknown')
    }
    if (after.identity !== proposal.worktree.identity || after.baseRevision !== revision || after.dirty || after.changedPaths.length > 0) {
      return updateCommitFailure(proposal, draft.commit, signal?.aborted ? 'interrupted' : 'blocked', 'commit postcondition did not prove a clean worktree at the returned revision; result is unknown and the worktree was retained', 'commit-creation-unknown')
    }
    draft.commit.status = 'created'
    draft.commit.executionStatus = 'commit-created'
    draft.commit.revision = revision
    proposal.executionStatus.commit = 'commit-created'
    proposal.operationStatus = 'commit-created'
    proposal.commitCreated = true
    recordProposalEvent(proposal, 'commit', 'local commit created in the isolated worktree; source workspace and remote were not modified')
    return resultForWithCommit(proposal, 'local commit created in the isolated worktree; source workspace and remote were not modified', draft.commit)
  }

  rejectCommit(commitId: string): ChangeProposalResult {
    const draft = this.commits.get(commitId)
    if (!draft) return blockedResult('blocked', 'commit draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this commit draft is no longer available')
    if (draft.commit.status !== 'awaiting-confirmation') return resultForWithCommit(proposal, 'commit draft is no longer awaiting confirmation', draft.commit)
    draft.commit.status = 'rejected'
    proposal.operationStatus = 'commit-rejected'
    recordProposalEvent(proposal, 'commit', 'commit draft rejected; no Git commit was created')
    return resultForWithCommit(proposal, 'commit draft rejected; no Git commit was created', draft.commit)
  }

  async prepareLanding(request: ChangeProposalLandingRequest, signal?: AbortSignal): Promise<ChangeProposalResult> {
    if (signal?.aborted) return blockedResult('interrupted', 'source landing preparation was interrupted before validation')
    const proposal = this.proposals.get(request.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (proposal.landing) return resultForWithLanding(proposal, 'this proposal already has a source landing draft; terminal landing states are not replayable', proposal.landing)
    if (proposal.status !== 'confirmed' || !proposal.worktree) return resultFor(proposal, 'source landing requires a confirmed proposal with a managed worktree')
    if (!proposal.commit || proposal.commit.status !== 'created' || proposal.commit.executionStatus !== 'commit-created' || !proposal.commit.revision) {
      return resultFor(proposal, 'source landing requires a created local commit with a known revision')
    }
    if (!isSafeGitRevision(proposal.commit.revision)) return resultFor(proposal, 'source landing target revision is not a safe Git revision')

    let source: InspectedSourceWorktree
    try {
      source = await this.adapter.inspectSource(proposal.repositoryRoot, proposal.workspaceRoot, signal)
    } catch (error) {
      return resultFor(proposal, `source landing inspection failed: ${redactError(error)}`)
    }
    if (path.resolve(source.repositoryRoot) !== path.resolve(proposal.repositoryRoot)) return resultFor(proposal, 'source workspace repository root no longer matches the proposal')
    if (source.dirty) return resultFor(proposal, 'source landing requires a clean source workspace')
    if (source.revision !== proposal.baseRevision) return resultFor(proposal, 'source workspace HEAD no longer matches the proposal base revision')

    const landing: ChangeProposalLanding = {
      landingId: `landing-${randomUUID()}`,
      confirmationDigest: '',
      status: 'awaiting-confirmation',
      sourcePath: source.path,
      sourceRevision: proposal.baseRevision,
      commitRevision: proposal.commit.revision,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.limits.expirationMs).toISOString(),
      executionStatus: 'landing-not-performed',
    }
    landing.confirmationDigest = createLandingDigest(proposal, landing)
    proposal.landing = landing
    proposal.operationStatus = 'landing-awaiting-confirmation'
    this.landings.set(landing.landingId, { proposalId: proposal.proposalId, landing })
    recordProposalEvent(proposal, 'landing', 'source landing draft prepared; exact landing digest and host approval are required before source mutation')
    return resultForWithLanding(proposal, 'source landing draft prepared; exact landing digest and host approval are required before source mutation', landing)
  }

  async confirmLanding(
    landingId: string,
    confirmationDigest: string,
    authorizer: ChangeProposalLandingAuthorizer | undefined,
    execution?: ChangeProposalLandingExecution,
    signal?: AbortSignal,
  ): Promise<ChangeProposalResult> {
    const draft = this.landings.get(landingId)
    if (!draft) return blockedResult('blocked', 'source landing draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this source landing draft is no longer available')
    if (draft.landing.status !== 'awaiting-confirmation') return resultForWithLanding(proposal, 'source landing draft is no longer awaiting confirmation', draft.landing)
    if (signal?.aborted) return updateLandingFailure(proposal, draft.landing, 'interrupted', 'source landing confirmation was interrupted before approval', 'landing-not-performed')
    if (Date.now() >= Date.parse(draft.landing.expiresAt)) return updateLandingFailure(proposal, draft.landing, 'blocked', 'source landing confirmation window has expired', 'landing-not-performed')
    if (!sameDigest(draft.landing.confirmationDigest, confirmationDigest)) return resultForWithLanding(proposal, 'source landing confirmation digest does not match the pending draft', draft.landing)
    if (proposal.status !== 'confirmed' || !proposal.worktree || !proposal.commit || proposal.commit.status !== 'created' || proposal.commit.executionStatus !== 'commit-created' || proposal.commit.revision !== draft.landing.commitRevision) {
      return updateLandingFailure(proposal, draft.landing, 'blocked', 'source landing requires the unchanged confirmed proposal and created commit', 'landing-not-performed')
    }

    let source: InspectedSourceWorktree
    try {
      source = await this.adapter.inspectSource(proposal.repositoryRoot, proposal.workspaceRoot, signal)
    } catch (error) {
      return updateLandingFailure(proposal, draft.landing, 'blocked', `live source landing inspection failed: ${redactError(error)}`, 'landing-not-performed')
    }
    if (path.resolve(source.repositoryRoot) !== path.resolve(proposal.repositoryRoot) || path.resolve(source.path) !== path.resolve(draft.landing.sourcePath) || source.revision !== draft.landing.sourceRevision || source.dirty) {
      return updateLandingFailure(proposal, draft.landing, 'blocked', 'source landing preconditions no longer match the clean exact-base source workspace', 'landing-not-performed')
    }
    if (!authorizer) return updateLandingFailure(proposal, draft.landing, 'blocked', 'source landing approval capability is unavailable', 'landing-not-performed')

    let approval: ChangeProposalLandingApproval
    try {
      approval = await authorizer.authorize({
        landingId: draft.landing.landingId,
        confirmationDigest: draft.landing.confirmationDigest,
        sourcePath: draft.landing.sourcePath,
        commitRevision: draft.landing.commitRevision,
        execution,
        signal,
      })
    } catch (error) {
      return resultForWithLanding(proposal, `source landing approval failed closed: ${redactError(error)}`, draft.landing)
    }
    if (!approval.allowed) return resultForWithLanding(proposal, approval.reason || 'source landing approval was rejected; the draft remains awaiting confirmation', draft.landing)
    if (!approval.auditId) return updateLandingFailure(proposal, draft.landing, 'blocked', 'source landing approval did not provide an audit id', 'landing-not-performed')
    draft.landing.approvalAuditId = boundedRedactedText(approval.auditId, this.limits.maxTextBytes)

    let landedRevision: string
    try {
      landedRevision = await this.adapter.land(proposal.repositoryRoot, proposal.workspaceRoot, draft.landing.sourceRevision, draft.landing.commitRevision, signal)
    } catch (error) {
      const uncertain = error instanceof LandingOperationError && error.uncertain
      return updateLandingFailure(
        proposal,
        draft.landing,
        signal?.aborted ? 'interrupted' : 'blocked',
        `source fast-forward landing failed${uncertain ? '; landing result is unknown and source/worktree were retained' : ''}: ${redactError(error)}`,
        uncertain ? 'landing-creation-unknown' : 'landing-not-performed',
      )
    }

    let after: InspectedSourceWorktree
    try {
      after = await this.adapter.inspectSource(proposal.repositoryRoot, proposal.workspaceRoot, signal)
    } catch (error) {
      return updateLandingFailure(proposal, draft.landing, signal?.aborted ? 'interrupted' : 'blocked', `source landing postcondition inspection failed; result is unknown and source/worktree were retained: ${redactError(error)}`, 'landing-creation-unknown')
    }
    if (path.resolve(after.repositoryRoot) !== path.resolve(proposal.repositoryRoot) || path.resolve(after.path) !== path.resolve(draft.landing.sourcePath) || after.revision !== draft.landing.commitRevision || landedRevision !== draft.landing.commitRevision || after.dirty) {
      return updateLandingFailure(proposal, draft.landing, signal?.aborted ? 'interrupted' : 'blocked', 'source landing postcondition did not prove the target revision and clean source workspace; result is unknown and source/worktree were retained', 'landing-creation-unknown')
    }
    draft.landing.status = 'landed'
    draft.landing.executionStatus = 'landing-completed'
    draft.landing.landedRevision = landedRevision
    proposal.executionStatus.landing = 'landing-completed'
    proposal.operationStatus = 'landing-completed'
    proposal.sourceLanded = true
    recordProposalEvent(proposal, 'landing', 'source workspace fast-forward landed the isolated commit; remote and push were not performed')
    return resultForWithLanding(proposal, 'source workspace fast-forward landed the isolated commit; remote and push were not performed', draft.landing)
  }

  rejectLanding(landingId: string): ChangeProposalResult {
    const draft = this.landings.get(landingId)
    if (!draft) return blockedResult('blocked', 'source landing draft is unknown to the current session')
    const proposal = this.proposals.get(draft.proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal for this source landing draft is no longer available')
    if (draft.landing.status !== 'awaiting-confirmation') return resultForWithLanding(proposal, 'source landing draft is no longer awaiting confirmation', draft.landing)
    draft.landing.status = 'rejected'
    proposal.operationStatus = 'landing-rejected'
    recordProposalEvent(proposal, 'landing', 'source landing draft rejected; source workspace was not modified')
    return resultForWithLanding(proposal, 'source landing draft rejected; source workspace was not modified', draft.landing)
  }

  reject(proposalId: string): ChangeProposalResult {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (proposal.status !== 'awaiting-confirmation') return resultFor(proposal, 'proposal is no longer awaiting confirmation')
    proposal.status = 'rejected'
    proposal.operationStatus = 'blocked'
    recordProposalEvent(proposal, 'proposal', 'proposal rejected; no worktree was created')
    return resultFor(proposal, 'proposal rejected; no worktree was created')
  }

  async release(proposalId: string, signal?: AbortSignal): Promise<ChangeProposalResult> {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return blockedResult('blocked', 'proposal is unknown to the current session')
    if (proposal.status !== 'confirmed' || !proposal.worktree) return resultFor(proposal, 'only a confirmed proposal with a managed worktree can be released')
    if (signal?.aborted) return mutateStatus(proposal, 'interrupted', 'blocked', 'worktree release was interrupted', 'release')
    try {
      const inspected = await this.adapter.inspect(proposal.repositoryRoot, proposal.worktree, signal)
      if (inspected.identity !== proposal.worktree.identity) return mutateStatus(proposal, 'blocked', 'blocked', 'worktree identity no longer matches the session-owned worktree', 'release')
      if (inspected.dirty) return mutateStatus(proposal, 'blocked', 'blocked', 'worktree has uncommitted changes; refusing force removal', 'release')
      await this.adapter.remove(proposal.repositoryRoot, proposal.worktree, signal)
      proposal.status = 'released'
      proposal.operationStatus = 'released'
      recordProposalEvent(proposal, 'release', 'session-owned clean worktree released')
      return resultFor(proposal, 'session-owned clean worktree released')
    } catch (error) {
      return mutateStatus(proposal, signal?.aborted ? 'interrupted' : 'blocked', 'blocked', `worktree release failed: ${redactError(error)}`, 'release')
    }
  }
}

function updatePatchFailure(
  proposal: ChangeProposal,
  patch: ChangeProposalPatch,
  status: 'blocked' | 'interrupted',
  reason: string,
  executionStatus: ChangeProposalPatch['executionStatus'] = 'patch-not-applied',
): ChangeProposalResult {
  patch.status = status
  patch.executionStatus = executionStatus
  proposal.executionStatus.patch = executionStatus
  proposal.operationStatus = 'blocked'
  recordProposalEvent(proposal, 'patch', reason)
  return resultFor(proposal, reason)
}

function updateCommitFailure(
  proposal: ChangeProposal,
  commit: ChangeProposalCommit,
  status: 'blocked' | 'interrupted',
  reason: string,
  executionStatus: ChangeProposalCommitExecutionStatus,
): ChangeProposalResult {
  commit.status = status
  commit.executionStatus = executionStatus
  proposal.executionStatus.commit = executionStatus
  proposal.operationStatus = status === 'interrupted' ? 'commit-interrupted' : 'commit-blocked'
  recordProposalEvent(proposal, 'commit', reason)
  return resultForWithCommit(proposal, reason, commit)
}

function updateLandingFailure(
  proposal: ChangeProposal,
  landing: ChangeProposalLanding,
  status: 'blocked' | 'interrupted',
  reason: string,
  executionStatus: ChangeProposalLandingExecutionStatus,
): ChangeProposalResult {
  landing.status = status
  landing.executionStatus = executionStatus
  proposal.executionStatus.landing = executionStatus
  proposal.operationStatus = status === 'interrupted' ? 'landing-interrupted' : executionStatus === 'landing-creation-unknown' ? 'landing-creation-unknown' : 'landing-blocked'
  recordProposalEvent(proposal, 'landing', reason)
  return resultForWithLanding(proposal, reason, landing)
}

function recordVerification(
  proposal: ChangeProposal,
  patch: ChangeProposalPatch,
  verification: ChangeProposalVerification,
): ChangeProposalResult {
  patch.verificationStatus = verification.status
  patch.verification = verification
  proposal.operationStatus = verificationOperationStatus(verification.status)
  recordProposalEvent(proposal, 'verification', verification.reason)
  return resultForWithVerification(proposal, verification.reason, verification)
}

function resultForWithVerification(proposal: ChangeProposal, reason: string, verification: ChangeProposalVerification): ChangeProposalResult {
  return { ...resultFor(proposal, reason), verification: { ...verification } }
}

function resultForWithCommit(proposal: ChangeProposal, reason: string, commit: ChangeProposalCommit): ChangeProposalResult {
  return { ...resultFor(proposal, reason), commit: { ...commit } }
}

function resultForWithLanding(proposal: ChangeProposal, reason: string, landing: ChangeProposalLanding): ChangeProposalResult {
  return { ...resultFor(proposal, reason), landing: { ...landing } }
}

function resultForWithLive(proposal: ChangeProposal, reason: string, liveInspection: ChangeProposalLiveInspection): ChangeProposalResult {
  return { ...resultFor(proposal, reason), liveInspection }
}

function resultForWithLandingAssessment(proposal: ChangeProposal, reason: string, landingAssessment: ChangeProposalLandingAssessment): ChangeProposalResult {
  return { ...resultFor(proposal, reason), landingAssessment: { ...landingAssessment } }
}

function resultForWithReleaseAssessment(proposal: ChangeProposal, reason: string, releaseAssessment: ChangeProposalReleaseAssessment): ChangeProposalResult {
  return { ...resultFor(proposal, reason), releaseAssessment: { ...releaseAssessment } }
}

function createLandingAssessment(
  status: ChangeProposalLandingInspectionStatus,
  relation: ChangeProposalLandingRelation,
  reason: string,
): ChangeProposalLandingAssessment {
  return {
    status,
    relation,
    reason,
    checkedAt: new Date().toISOString(),
    sessionOnly: true,
  }
}

function createReleaseAssessment(
  status: ChangeProposalReleaseAssessment['status'],
  relation: ChangeProposalReleaseRelation,
  reason: string,
): ChangeProposalReleaseAssessment {
  return {
    status,
    relation,
    reason,
    checkedAt: new Date().toISOString(),
    sessionOnly: true,
  }
}

function isTargetUnavailableInspection(error: unknown): boolean {
  if (error instanceof LandingInspectionError) return error.targetUnavailable
  if (!error || typeof error !== 'object') return false
  return (error as { name?: unknown; targetUnavailable?: unknown }).name === 'LandingInspectionError'
    && (error as { targetUnavailable?: unknown }).targetUnavailable === true
}

function createLiveInspection(
  source: ChangeProposalLiveSourceObservation,
  worktree: ChangeProposalLiveWorktreeObservation,
  maxTextBytes = 4_096,
): ChangeProposalLiveInspection {
  const statuses = [source.status, worktree.status].filter((status) => status !== 'not-applicable')
  const available = statuses.filter((status) => status === 'available').length
  const unknown = statuses.filter((status) => status === 'unknown').length
  const status: ChangeProposalLiveInspection['status'] = statuses.length === 0
    ? 'not-applicable'
    : unknown === 0
      ? 'available'
      : available > 0
        ? 'partial'
        : 'unknown'
  const details = [source.reason, worktree.reason].filter((reason) => reason.length > 0).join('; ')
  return {
    status,
    reason: boundedRedactedText(`live observation ${status}; ${details}`, maxTextBytes),
    checkedAt: new Date().toISOString(),
    sessionOnly: true,
    source,
    worktree,
  }
}

function interruptedLiveInspection(proposal: ChangeProposal, maxTextBytes: number): ChangeProposalLiveInspection {
  const source: ChangeProposalLiveSourceObservation = {
    status: 'unknown',
    reason: boundedRedactedText('source workspace inspection was interrupted before adapter access', maxTextBytes),
  }
  const worktree: ChangeProposalLiveWorktreeObservation = proposal.worktree
    ? { status: 'unknown', reason: boundedRedactedText('managed worktree inspection was interrupted before adapter access', maxTextBytes) }
    : { status: 'not-applicable', reason: 'proposal has no managed worktree to inspect' }
  return createLiveInspection(source, worktree, maxTextBytes)
}

function verificationOperationStatus(status: ChangeProposalVerification['status']): ChangeProposal['operationStatus'] {
  if (status === 'passed') return 'patch-verification-passed'
  if (status === 'interrupted' || status === 'cancelled') return 'patch-verification-interrupted'
  if (status === 'failed' || status === 'timed-out') return 'patch-verification-failed'
  return 'patch-verification-blocked'
}

function unavailableVerification(
  recipeId: string,
  worktreeIdentity: string,
  reason: string,
  status: ChangeProposalVerification['status'] = 'blocked',
): ChangeProposalVerification {
  return {
    verificationId: `verification-${randomUUID()}`,
    auditId: `verification-${randomUUID()}`,
    recipeId,
    status,
    reason,
    worktreeIdentity,
    stdout: '',
    stderr: '',
    outputTruncated: false,
    redacted: false,
    redactedMatchCount: 0,
    createdAt: new Date().toISOString(),
  }
}

function normalizeProposalListLimit(value: number | undefined): number | undefined {
  const limit = value === undefined ? DEFAULT_CHANGE_PROPOSAL_LIST_LIMIT : value
  return Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_CHANGE_PROPOSAL_LIST_LIMIT ? limit : undefined
}

function compareProposalCreation(left: ChangeProposal, right: ChangeProposal): number {
  return right.createdAt.localeCompare(left.createdAt) || right.proposalId.localeCompare(left.proposalId)
}

function proposalSummary(proposal: ChangeProposal): ChangeProposalSummary {
  return {
    proposalId: proposal.proposalId,
    intent: proposal.intent,
    status: proposal.status,
    operationStatus: proposal.operationStatus,
    targetCount: proposal.targets.length,
    confirmedTargetCount: proposal.targets.filter((target) => target.status === 'confirmed').length,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    executionStatus: { ...proposal.executionStatus },
    patchApplied: proposal.patchApplied,
    commitCreated: proposal.commitCreated,
    sourceLanded: proposal.sourceLanded,
    pushPerformed: false,
    patch: proposal.patch ? {
      patchId: proposal.patch.patchId,
      status: proposal.patch.status,
      executionStatus: proposal.patch.executionStatus,
      verificationStatus: proposal.patch.verificationStatus,
    } : undefined,
    commit: proposal.commit ? {
      commitId: proposal.commit.commitId,
      status: proposal.commit.status,
      executionStatus: proposal.commit.executionStatus,
      revision: proposal.commit.revision,
    } : undefined,
    landing: proposal.landing ? {
      landingId: proposal.landing.landingId,
      status: proposal.landing.status,
      executionStatus: proposal.landing.executionStatus,
      landedRevision: proposal.landing.landedRevision,
    } : undefined,
  }
}

function resultFor(proposal: ChangeProposal, reason: string): ChangeProposalResult {
  return { status: proposal.status, operationStatus: proposal.operationStatus, reason, proposal: cloneProposal(proposal) }
}

function blockedProposalList(reason: string): ChangeProposalListResult {
  return {
    status: 'blocked',
    reason,
    proposals: [],
    total: 0,
    returned: 0,
    truncated: false,
    sessionOnly: true,
  }
}

function blockedProposalHistory(reason: string): ChangeProposalHistoryResult {
  return {
    status: 'blocked',
    reason,
    events: [],
    total: 0,
    returned: 0,
    truncated: false,
    sessionOnly: true,
  }
}

function blockedProposalRecovery(reason: string): ChangeProposalRecoveryResult {
  return {
    status: 'blocked',
    reason,
    sessionOnly: true,
  }
}

function recoveryDecision(proposal: ChangeProposal): {
  recommendation: ChangeProposalRecoveryRecommendation
  allowedActions: ChangeProposalRecoveryAction[]
  manualReviewRequired: boolean
  reason: string
} {
  if (proposal.status === 'rejected' || proposal.status === 'released') {
    return { recommendation: 'no-action', allowedActions: [], manualReviewRequired: false, reason: 'proposal is in a terminal session state with no automatic continuation' }
  }
  if (requiresManualRecoveryReview(proposal)) {
    return {
      recommendation: 'manual-review-required',
      allowedActions: [],
      manualReviewRequired: true,
      reason: `proposal state ${proposal.operationStatus} is blocked, interrupted, uncertain, or not safe for automatic continuation`,
    }
  }
  if (proposal.status === 'awaiting-confirmation') {
    return { recommendation: 'confirm', allowedActions: ['confirm', 'reject'], manualReviewRequired: false, reason: 'proposal is awaiting the explicit confirmation digest' }
  }
  if (proposal.status !== 'confirmed') {
    return { recommendation: 'manual-review-required', allowedActions: [], manualReviewRequired: true, reason: 'proposal status is not a safe continuation state' }
  }
  if (!proposal.patch) {
    return { recommendation: 'prepare-patch', allowedActions: ['prepare-patch', 'release'], manualReviewRequired: false, reason: 'confirmed proposal has no patch draft; prepare a bounded patch or release the clean worktree' }
  }
  if (proposal.patch.status === 'awaiting-confirmation') {
    return { recommendation: 'confirm-patch', allowedActions: ['confirm-patch', 'reject-patch', 'release'], manualReviewRequired: false, reason: 'patch draft is awaiting its exact confirmation digest' }
  }
  if (proposal.patch.status === 'rejected') {
    return { recommendation: 'release', allowedActions: ['release'], manualReviewRequired: false, reason: 'patch draft was rejected and the proposal worktree can only be safely released' }
  }
  if (proposal.patch.status !== 'applied') {
    return { recommendation: 'manual-review-required', allowedActions: [], manualReviewRequired: true, reason: 'patch state does not prove a safe continuation' }
  }
  if (proposal.patch.verificationStatus === 'not-run') {
    return { recommendation: 'verify-patch', allowedActions: ['verify-patch'], manualReviewRequired: false, reason: 'applied patch has not yet recorded a verification result' }
  }
  if (proposal.patch.verificationStatus !== 'passed') {
    return { recommendation: 'manual-review-required', allowedActions: [], manualReviewRequired: true, reason: 'patch verification did not prove a safe continuation' }
  }
  if (!proposal.commit) {
    return { recommendation: 'prepare-commit', allowedActions: ['prepare-commit'], manualReviewRequired: false, reason: 'patch verification passed and a commit draft can be prepared' }
  }
  if (proposal.commit.status === 'awaiting-confirmation') {
    return { recommendation: 'confirm-commit', allowedActions: ['confirm-commit', 'reject-commit'], manualReviewRequired: false, reason: 'commit draft is awaiting its exact digest and host approval' }
  }
  if (proposal.commit.status !== 'created') {
    return { recommendation: 'manual-review-required', allowedActions: [], manualReviewRequired: true, reason: 'commit state does not prove a safe continuation' }
  }
  if (!proposal.landing) {
    return { recommendation: 'prepare-landing', allowedActions: ['prepare-landing', 'release'], manualReviewRequired: false, reason: 'local commit is known and source landing can be prepared or the clean worktree can be released' }
  }
  if (proposal.landing.status === 'awaiting-confirmation') {
    return { recommendation: 'confirm-landing', allowedActions: ['confirm-landing', 'reject-landing'], manualReviewRequired: false, reason: 'source landing draft is awaiting its exact digest and host approval' }
  }
  if (proposal.landing.status === 'landed' || proposal.landing.status === 'rejected') {
    return { recommendation: 'release', allowedActions: ['release'], manualReviewRequired: false, reason: 'source landing is terminal and the session-owned clean worktree can be released' }
  }
  return { recommendation: 'manual-review-required', allowedActions: [], manualReviewRequired: true, reason: 'landing state does not prove a safe continuation' }
}

function requiresManualRecoveryReview(proposal: ChangeProposal): boolean {
  if (proposal.status === 'blocked' || proposal.status === 'interrupted') return true
  if (proposal.executionStatus.patch === 'patch-application-unknown' || proposal.executionStatus.commit === 'commit-creation-unknown' || proposal.executionStatus.landing === 'landing-creation-unknown') return true
  if (proposal.patch && (proposal.patch.status === 'blocked' || proposal.patch.status === 'interrupted' || proposal.patch.verificationStatus === 'failed' || proposal.patch.verificationStatus === 'blocked' || proposal.patch.verificationStatus === 'interrupted' || proposal.patch.verificationStatus === 'denied' || proposal.patch.verificationStatus === 'sandbox-unavailable' || proposal.patch.verificationStatus === 'timed-out' || proposal.patch.verificationStatus === 'cancelled')) return true
  if (proposal.commit && (proposal.commit.status === 'blocked' || proposal.commit.status === 'interrupted')) return true
  if (proposal.landing && (proposal.landing.status === 'blocked' || proposal.landing.status === 'interrupted')) return true
  return false
}

function mutateStatus(
  proposal: ChangeProposal,
  status: ChangeProposal['status'],
  operationStatus: ChangeProposal['operationStatus'],
  reason: string,
  phase: ChangeProposalEventPhase = 'proposal',
): ChangeProposalResult {
  proposal.status = status
  proposal.operationStatus = operationStatus
  recordProposalEvent(proposal, phase, reason)
  return resultFor(proposal, reason)
}

function blockedResult(status: Extract<ChangeProposal['status'], 'blocked' | 'interrupted'>, reason: string): ChangeProposalResult {
  return { status, operationStatus: 'blocked', reason }
}

function recordProposalEvent(proposal: ChangeProposal, phase: ChangeProposalEventPhase, reason: string): void {
  proposalEventRecorders.get(proposal)?.(phase, reason)
}

function cloneProposalEvent(event: ChangeProposalEvent): ChangeProposalEvent {
  return {
    ...event,
    executionStatus: { ...event.executionStatus },
  }
}

function cloneProposal(proposal: ChangeProposal): ChangeProposal {
  return {
    ...proposal,
    targets: proposal.targets.map((target) => ({ ...target })),
    evidenceIds: [...proposal.evidenceIds],
    limitations: [...proposal.limitations],
    risks: [...proposal.risks],
    worktree: proposal.worktree ? { ...proposal.worktree } : undefined,
    commit: proposal.commit ? { ...proposal.commit } : undefined,
    landing: proposal.landing ? { ...proposal.landing } : undefined,
    patch: proposal.patch ? {
      ...proposal.patch,
      limitations: [...proposal.patch.limitations],
      summary: clonePatchSummary(proposal.patch.summary),
      verification: proposal.patch.verification ? { ...proposal.patch.verification } : undefined,
    } : undefined,
  }
}
