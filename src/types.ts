export type GoalIntent = 'onboarding' | 'architecture' | 'custom'

export type AnalysisStatus =
  | 'confirmed'
  | 'syntax-confirmed'
  | 'inferred'
  | 'unconfirmed'
  | 'not-analyzed'
  | 'read-failed'
  | 'safety-skipped'
  | 'budget-exhausted'
  | 'interrupted'

export interface GoalSpec {
  intent?: GoalIntent
  audience?: string
  scope?: string[]
  outputs?: string[]
  permissions: string[]
  success_criteria?: string[]
  confirmed: boolean
}

export interface RepoAtlasConfig {
  workspaceRoot: string
  scope?: string[]
  excludeDirs: string[]
  sensitiveFilePatterns: string[]
  maxCandidateFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  maxActions: number
  maxAstFiles: number
  maxAstTokensPerFile: number
  maxAstObservationsPerFile: number
  maxAstObservationTextBytes: number
  cacheValidation: 'metadata' | 'content'
  respectGitIgnore: boolean
  controlledActions: ControlledActionsConfig
}

export type ControlledActionSandboxMode = 'read-only' | 'workspace-write'

export interface ControlledActionRecipe {
  id: string
  command: string
  args: string[]
  sandboxMode: ControlledActionSandboxMode
  timeoutMs: number
  maxOutputBytes: number
  enabled: boolean
}

export interface ControlledActionsConfig {
  enabled: boolean
  recipes: ControlledActionRecipe[]
}

export type ToolAction =
  | 'list'
  | 'read'
  | 'search'
  | 'parse-config'
  | 'parse-ast'
  | 'write'
  | 'delete'
  | 'rename'
  | 'shell'
  | 'network'
  | 'install'
  | 'git-push'
  | 'external-service'
  | 'export-report'

export interface PolicyDecision {
  allowed: boolean
  action: ToolAction
  reason: string
  path?: string
  auditId: string
}

export interface AuditEvent {
  auditId: string
  timestamp: string
  action: ToolAction | 'skip' | 'failure' | 'budget'
  status: 'allowed' | 'denied' | 'skipped' | 'failed'
  path?: string
  reason: string
  detail?: string
}

export interface Evidence {
  evidenceId: string
  sourcePath: string
  locator: string
  observation: string
  status: AnalysisStatus
  redactionState: 'clean' | 'redacted' | 'not-applicable'
  evidenceKind?: 'text' | 'ast'
  astObservation?: AstObservation
  astParser?: AstParser
}

export type AstObservationKind = 'import' | 'export' | 'declaration' | 'function' | 'class' | 'variable' | 'call'

export interface AstObservation {
  kind: AstObservationKind
  line: number
  column: number
  summary: string
  name?: string
  moduleSpecifier?: string
  /** True only for an unchanged, bounded semantic value; absent/false is display-only. */
  moduleSpecifierExact?: boolean
}

export type AstParser = 'typescript-compiler' | 'bounded-structural' | 'cache' | 'unavailable'

export interface AstFileAnalysis {
  relativePath: string
  status: AnalysisStatus
  parser: AstParser
  observationCount: number
  reason?: string
}

export interface AstParseResult extends AstFileAnalysis {
  observations: AstObservation[]
}

export const EVIDENCE_CACHE_SCHEMA_VERSION = 4 as const

export interface EvidenceFingerprint {
  relativePath: string
  sizeBytes: number
  mtimeMs: number
  ctimeMs: number
  version?: string
}

export interface EvidenceCacheEntry {
  fingerprint: EvidenceFingerprint
  coverage: string[]
  evidence: Evidence[]
  sourceMaterial?: { text: string; evidenceId: string; redactedContentSha256: string }
}

export interface SourceSnapshot {
  text: string
  evidenceId: string
  redactedContentSha256: string
  validation: 'read-and-version-checked' | 'metadata-reused' | 'not-revalidated'
}

export interface EvidenceCache {
  schemaVersion: typeof EVIDENCE_CACHE_SCHEMA_VERSION
  workspaceRoot: string
  policyFingerprint: string
  readerIdentity: string
  ignoreFingerprint: string
  entries: EvidenceCacheEntry[]
}

export interface IncrementalEvidenceSummary {
  mode: 'full' | 'incremental'
  reused: string[]
  invalidated: string[]
  reread: string[]
  new: string[]
  uncovered: string[]
}

export interface Conclusion {
  conclusionId: string
  text: string
  status: AnalysisStatus
  evidenceIds: string[]
}

export interface ReActActionRecord {
  actionId: string
  thought: string
  action: ToolAction
  input: string
  observation: string
  status: AnalysisStatus
  evidenceIds: string[]
}

export interface ScannedFile {
  relativePath: string
  sizeBytes: number
  kind: 'text' | 'binary' | 'too-large' | 'sensitive' | 'unreadable'
  fingerprint?: EvidenceFingerprint
}

export interface ScanResult {
  files: ScannedFile[]
  skipped: Array<{ path: string; reason: string }>
  failures: Array<{ path: string; reason: string }>
  audits: AuditEvent[]
  ignorePolicy?: { mode: 'disabled' | 'root-positive-patterns'; fingerprint: string; unsupportedRuleCount: number; nestedPoliciesObserved: number }
  budget: {
    candidateFiles: number
    readBytes: number
    actions: number
    exhausted: boolean
  }
}

export interface ReadResult {
  relativePath: string
  status: AnalysisStatus
  text?: string
  redacted: boolean
  reason?: string
  sizeBytes?: number
}

export interface ArchitectureEdge {
  from: string
  to: string
  relation: 'imports' | 'references' | 'configures'
  evidenceIds: string[]
  status: AnalysisStatus
}

export interface AnalysisPlan {
  name: 'onboarding' | 'architecture'
  steps: Array<{
    action: Extract<ToolAction, 'list' | 'read' | 'search' | 'parse-config' | 'parse-ast'>
    target: string
    purpose: string
  }>
}

export interface AnalysisSession {
  sessionId: string
  workspaceRoot: string
  goal: GoalSpec
  plan: AnalysisPlan
  scan: ScanResult
  evidence: Evidence[]
  conclusions: Conclusion[]
  actions: ReActActionRecord[]
  edges: ArchitectureEdge[]
  ast?: AstFileAnalysis[]
  project: {
    name: string
    summary: string
    techStack: string[]
    entries: string[]
    coreDirectories: string[]
    runtimeConfig: string[]
    testConfig: string[]
    readingOrder: string[]
  }
  interrupted: boolean
  evidenceCache?: EvidenceCache
  incrementalSummary?: IncrementalEvidenceSummary
  reader?: { identity: string; kind: 'local' | 'harness'; hostBacked: boolean }
  sourceSnapshots?: ReadonlyMap<string, SourceSnapshot>
}

export interface AtlasData {
  version: '1'
  sessionId: string
  project: AnalysisSession['project']
  nodes: Array<{ id: string; label: string; kind: 'file' | 'directory' | 'config'; status: AnalysisStatus }>
  edges: ArchitectureEdge[]
  ast?: AstFileAnalysis[]
  conclusions: Conclusion[]
  evidence: Evidence[]
  limitations: string[]
}

export interface AnalysisReport {
  sessionId: string
  markdown: string
  mermaid: string
  atlas: AtlasData
  exportable: boolean
  ast?: AstFileAnalysis[]
  incrementalSummary?: IncrementalEvidenceSummary
}

export type ChangeProposalOperation = 'add' | 'modify' | 'delete'

export type ChangeProposalStatus = 'awaiting-confirmation' | 'confirmed' | 'rejected' | 'blocked' | 'interrupted' | 'released'

export type ChangeProposalOperationStatus =
  | 'proposal'
  | 'worktree-created'
  | 'patch-awaiting-confirmation'
  | 'patch-applied'
  | 'patch-verification-passed'
  | 'patch-verification-failed'
  | 'patch-verification-blocked'
  | 'patch-verification-interrupted'
  | 'patch-rejected'
  | 'commit-awaiting-confirmation'
  | 'commit-created'
  | 'commit-rejected'
  | 'commit-blocked'
  | 'commit-interrupted'
  | 'landing-awaiting-confirmation'
  | 'landing-completed'
  | 'landing-rejected'
  | 'landing-blocked'
  | 'landing-interrupted'
  | 'landing-not-performed'
  | 'landing-creation-unknown'
  | 'patch-not-applied'
  | 'commit-not-created'
  | 'push-not-performed'
  | 'blocked'
  | 'released'

export interface ChangeProposalTargetRequest {
  relativePath: string
  operation: ChangeProposalOperation
  rationale?: string
}

export interface ChangeProposalRequest {
  sessionId: string
  intent: string
  targets: ChangeProposalTargetRequest[]
  evidenceIds?: string[]
}

export interface ChangeProposalListRequest {
  limit?: number
}

export interface ChangeProposalHistoryRequest {
  proposalId: string
  limit?: number
}

export interface ChangeProposalPatchRequest {
  proposalId: string
  patchText: string
}

export interface ChangeProposalVerifyPatchRequest {
  patchId: string
  confirmationDigest: string
  recipeId: string
}

export interface ChangeProposalCommitRequest {
  proposalId: string
  commitMessage: string
}

export interface ChangeProposalLandingRequest {
  proposalId: string
}

export type ChangeProposalLiveInspectionStatus = 'available' | 'partial' | 'unknown' | 'not-applicable'

export type ChangeProposalLiveCheckStatus = 'available' | 'unknown' | 'not-applicable'

export interface ChangeProposalLiveSourceObservation {
  status: ChangeProposalLiveCheckStatus
  reason: string
  clean?: boolean
  revision?: string
  baseRevisionMatches?: boolean
  repositoryRootMatches?: boolean
  workspacePathMatches?: boolean
}

export interface ChangeProposalLiveWorktreeObservation {
  status: ChangeProposalLiveCheckStatus
  reason: string
  clean?: boolean
  baseRevision?: string
  baseRevisionMatches?: boolean
  identityMatches?: boolean
  changedPathCount?: number
}

export interface ChangeProposalLiveInspection {
  status: ChangeProposalLiveInspectionStatus
  reason: string
  checkedAt: string
  sessionOnly: true
  source: ChangeProposalLiveSourceObservation
  worktree: ChangeProposalLiveWorktreeObservation
}

export type ChangeProposalLandingInspectionStatus = 'available' | 'not-applicable' | 'unknown'

export type ChangeProposalLandingRelation =
  | 'not-applicable'
  | 'fast-forwardable'
  | 'already-landed'
  | 'source-ahead'
  | 'diverged'
  | 'source-dirty'
  | 'source-revision-drift'
  | 'target-unavailable'
  | 'unknown'

export interface ChangeProposalLandingAssessment {
  status: ChangeProposalLandingInspectionStatus
  relation: ChangeProposalLandingRelation
  reason: string
  checkedAt: string
  sessionOnly: true
  sourceRevision?: string
  targetRevision?: string
  clean?: boolean
  baseRevisionMatches?: boolean
  repositoryRootMatches?: boolean
  workspacePathMatches?: boolean
}

export type ChangeProposalReleaseInspectionStatus = 'available' | 'not-applicable' | 'unknown'

export type ChangeProposalReleaseRelation =
  | 'not-applicable'
  | 'ready'
  | 'proposal-state-blocked'
  | 'worktree-dirty'
  | 'identity-mismatch'
  | 'unknown'

export interface ChangeProposalReleaseAssessment {
  status: ChangeProposalReleaseInspectionStatus
  relation: ChangeProposalReleaseRelation
  reason: string
  checkedAt: string
  sessionOnly: true
  clean?: boolean
  identityMatches?: boolean
}

export type ChangeProposalEventPhase = 'proposal' | 'patch' | 'verification' | 'commit' | 'landing' | 'release'

export interface ChangeProposalEvent {
  eventId: string
  proposalId: string
  phase: ChangeProposalEventPhase
  status: ChangeProposalStatus
  operationStatus: ChangeProposalOperationStatus
  executionStatus: ChangeProposalExecutionStatus
  reason: string
  createdAt: string
  sessionOnly: true
}

export interface ChangeProposalTarget {
  relativePath: string
  operation: ChangeProposalOperation
  rationale: string
  status: 'confirmed' | 'uncovered' | 'budget-exhausted'
  reason?: string
}

export interface ChangeProposalWorktree {
  path: string
  identity: string
  baseRevision: string
}

export type ChangeProposalPatchStatus = 'not-prepared' | 'awaiting-confirmation' | 'applied' | 'rejected' | 'blocked' | 'interrupted'

export type ChangeProposalPatchExecutionStatus = 'patch-not-applied' | 'patch-applied' | 'patch-application-unknown'

export type ChangeProposalVerificationStatus = 'not-run' | 'passed' | 'failed' | 'blocked' | 'interrupted' | 'denied' | 'sandbox-unavailable' | 'timed-out' | 'cancelled'

export type ChangeProposalCommitStatus = 'not-prepared' | 'awaiting-confirmation' | 'created' | 'rejected' | 'blocked' | 'interrupted'

export type ChangeProposalCommitExecutionStatus = 'commit-not-created' | 'commit-created' | 'commit-creation-unknown'

export type ChangeProposalLandingStatus = 'not-prepared' | 'awaiting-confirmation' | 'landed' | 'rejected' | 'blocked' | 'interrupted'

export type ChangeProposalLandingExecutionStatus = 'landing-not-performed' | 'landing-completed' | 'landing-creation-unknown'

export interface ChangeProposalPatchFileSummary {
  relativePath: string
  operation: ChangeProposalOperation
  additions: number
  deletions: number
  hunks: number
}

export interface ChangeProposalPatchSummary {
  bytes: number
  files: ChangeProposalPatchFileSummary[]
  hunks: number
  changedLines: number
}

export interface ChangeProposalVerification {
  verificationId: string
  auditId: string
  recipeId: string
  status: Exclude<ChangeProposalVerificationStatus, 'not-run'>
  reason: string
  worktreeIdentity: string
  stdout: string
  stderr: string
  outputTruncated: boolean
  redacted: boolean
  redactedMatchCount: number
  exitCode?: number | null
  signal?: string | null
  createdAt: string
}

export interface ChangeProposalPatchExport {
  patchId: string
  proposalId: string
  confirmationDigest: string
  patchText: string
  summary: ChangeProposalPatchSummary
  sessionOnly: true
  exportedAt: string
}

export interface ChangeProposalCommit {
  commitId: string
  confirmationDigest: string
  status: ChangeProposalCommitStatus
  message: string
  createdAt: string
  expiresAt: string
  executionStatus: ChangeProposalCommitExecutionStatus
  approvalAuditId?: string
  revision?: string
}

export interface ChangeProposalLanding {
  landingId: string
  confirmationDigest: string
  status: ChangeProposalLandingStatus
  sourcePath: string
  sourceRevision: string
  commitRevision: string
  createdAt: string
  expiresAt: string
  executionStatus: ChangeProposalLandingExecutionStatus
  approvalAuditId?: string
  landedRevision?: string
}

export interface ChangeProposalPatch {
  patchId: string
  confirmationDigest: string
  status: ChangeProposalPatchStatus
  summary: ChangeProposalPatchSummary
  limitations: string[]
  createdAt: string
  expiresAt: string
  executionStatus: ChangeProposalPatchExecutionStatus
  verificationStatus: ChangeProposalVerificationStatus
  verification?: ChangeProposalVerification
}

export interface ChangeProposalExecutionStatus {
  patch: ChangeProposalPatchExecutionStatus
  commit: ChangeProposalCommitExecutionStatus
  landing: ChangeProposalLandingExecutionStatus
  push: 'push-not-performed'
}

export interface ChangeProposal {
  proposalId: string
  sessionId: string
  workspaceRoot: string
  repositoryRoot: string
  baseRevision: string
  intent: string
  targets: ChangeProposalTarget[]
  evidenceIds: string[]
  limitations: string[]
  risks: string[]
  confirmationDigest: string
  status: ChangeProposalStatus
  operationStatus: ChangeProposalOperationStatus
  expiresAt: string
  executionStatus: ChangeProposalExecutionStatus
  patchApplied: boolean
  commitCreated: boolean
  sourceLanded: boolean
  pushPerformed: false
  createdAt: string
  worktree?: ChangeProposalWorktree
  patch?: ChangeProposalPatch
  commit?: ChangeProposalCommit
  landing?: ChangeProposalLanding
}

export interface ChangeProposalSummary {
  proposalId: string
  intent: string
  status: ChangeProposalStatus
  operationStatus: ChangeProposalOperationStatus
  targetCount: number
  confirmedTargetCount: number
  createdAt: string
  expiresAt: string
  executionStatus: ChangeProposalExecutionStatus
  patchApplied: boolean
  commitCreated: boolean
  sourceLanded: boolean
  pushPerformed: false
  patch?: {
    patchId: string
    status: ChangeProposalPatchStatus
    executionStatus: ChangeProposalPatchExecutionStatus
    verificationStatus: ChangeProposalVerificationStatus
  }
  commit?: {
    commitId: string
    status: ChangeProposalCommitStatus
    executionStatus: ChangeProposalCommitExecutionStatus
    revision?: string
  }
  landing?: {
    landingId: string
    status: ChangeProposalLandingStatus
    executionStatus: ChangeProposalLandingExecutionStatus
    landedRevision?: string
  }
}

export type ChangeProposalRecoveryAction =
  | 'confirm'
  | 'reject'
  | 'prepare-patch'
  | 'confirm-patch'
  | 'reject-patch'
  | 'verify-patch'
  | 'prepare-commit'
  | 'confirm-commit'
  | 'reject-commit'
  | 'prepare-landing'
  | 'confirm-landing'
  | 'reject-landing'
  | 'release'

export type ChangeProposalRecoveryRecommendation = ChangeProposalRecoveryAction | 'manual-review-required' | 'no-action'

export interface ChangeProposalRecoveryGuidance {
  proposalId: string
  proposal: ChangeProposalSummary
  recommendation: ChangeProposalRecoveryRecommendation
  allowedActions: ChangeProposalRecoveryAction[]
  manualReviewRequired: boolean
  reason: string
  sessionOnly: true
}

export interface ChangeProposalListResult {
  status: 'available' | 'blocked'
  reason: string
  proposals: ChangeProposalSummary[]
  total: number
  returned: number
  truncated: boolean
  sessionOnly: true
}

export interface ChangeProposalHistoryResult {
  status: 'available' | 'blocked'
  reason: string
  proposalId?: string
  events: ChangeProposalEvent[]
  total: number
  returned: number
  truncated: boolean
  sessionOnly: true
}

export interface ChangeProposalRecoveryResult {
  status: 'available' | 'blocked'
  reason: string
  guidance?: ChangeProposalRecoveryGuidance
  sessionOnly: true
}

export interface ChangeProposalResult {
  status: ChangeProposalStatus
  operationStatus: ChangeProposalOperationStatus
  reason: string
  proposal?: ChangeProposal
  patchExport?: ChangeProposalPatchExport
  verification?: ChangeProposalVerification
  commit?: ChangeProposalCommit
  landing?: ChangeProposalLanding
  liveInspection?: ChangeProposalLiveInspection
  landingAssessment?: ChangeProposalLandingAssessment
  releaseAssessment?: ChangeProposalReleaseAssessment
}
