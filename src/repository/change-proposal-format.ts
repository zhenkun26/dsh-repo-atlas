import { createHash, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { isSensitivePath, redactSecretLike } from '../safety/content-policy.ts'
import { checkWorkspacePath, isWithin } from '../safety/path-policy.ts'
import { isPathCoveredByScope } from './evidence-cache.ts'
import type { ChangeProposalLimits } from './change-proposal.ts'
import type {
  AnalysisSession,
  ChangeProposal,
  ChangeProposalCommit,
  ChangeProposalLanding,
  ChangeProposalPatch,
  ChangeProposalPatchFileSummary,
  ChangeProposalPatchSummary,
  ChangeProposalOperation,
  ChangeProposalTarget,
  ChangeProposalVerification,
  RepoAtlasConfig,
} from '../types.ts'

type InspectedWorktree = Awaited<ReturnType<import('./change-proposal.ts').GitWorktreeAdapter['inspect']>>

interface ParsedPatch {
  canonicalText: string
  summary: ChangeProposalPatchSummary
}

export function validateTargets(
  requests: readonly { relativePath: string; operation: ChangeProposalOperation; rationale?: string }[],
  session: AnalysisSession,
  config: RepoAtlasConfig,
  limits: ChangeProposalLimits,
): { targets: ChangeProposalTarget[]; limitations: string[] } {
  const targets: ChangeProposalTarget[] = []
  const limitations: string[] = []
  const seen = new Set<string>()
  for (const request of requests) {
    if (targets.length >= limits.maxTargets) {
      limitations.push('proposal target budget exhausted')
      break
    }
    const rawPath = String(request.relativePath ?? '')
    const check = checkWorkspacePath(session.workspaceRoot, rawPath)
    const normalized = check.allowed ? path.relative(session.workspaceRoot, check.absolutePath).replaceAll(path.sep, '/') || '.' : rawPath.replaceAll('\\', '/')
    if (seen.has(normalized)) {
      limitations.push(`duplicate target skipped: ${normalized}`)
      continue
    }
    seen.add(normalized)
    const operation = request.operation
    const rationale = boundedRedactedText(request.rationale ?? '用户未提供额外理由', limits.maxTextBytes)
    if (!isProposalOperation(operation)) {
      limitations.push(`${normalized}: unsupported target operation`)
      continue
    }
    if (!check.allowed) {
      targets.push({ relativePath: normalized, operation, rationale, status: 'uncovered', reason: check.reason })
      limitations.push(`${normalized}: ${check.reason}`)
      continue
    }
    if (isSensitivePath(normalized, config.sensitiveFilePatterns)) {
      targets.push({ relativePath: normalized, operation, rationale, status: 'uncovered', reason: 'sensitive path is not eligible for proposal targets' })
      limitations.push(`${normalized}: sensitive path is not eligible`)
      continue
    }
    if (config.excludeDirs.includes(normalized.split('/')[0] ?? '')) {
      targets.push({ relativePath: normalized, operation, rationale, status: 'uncovered', reason: 'excluded directory is not eligible for proposal targets' })
      limitations.push(`${normalized}: excluded directory is not eligible`)
      continue
    }
    if (!isPathCoveredByScope(normalized, session.goal.scope)) {
      targets.push({ relativePath: normalized, operation, rationale, status: 'uncovered', reason: 'target is outside the confirmed GoalSpec scope' })
      limitations.push(`${normalized}: outside confirmed scope`)
      continue
    }
    targets.push({ relativePath: normalized, operation, rationale, status: 'confirmed' })
  }
  return { targets, limitations }
}

export function deriveRisks(targets: readonly ChangeProposalTarget[]): string[] {
  return targets.filter((target) => target.status === 'confirmed' && target.operation === 'delete').map((target) => `delete operation requires explicit review: ${target.relativePath}`)
}

export function createProposalDigest(proposal: ChangeProposal): string {
  const payload = JSON.stringify({
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    workspaceRoot: path.resolve(proposal.workspaceRoot),
    baseRevision: proposal.baseRevision,
    expiresAt: proposal.expiresAt,
    intent: proposal.intent,
    targets: proposal.targets,
    evidenceIds: proposal.evidenceIds,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export function sameDigest(expected: string, received: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(received)) return false
  const left = Buffer.from(expected, 'hex')
  const right = Buffer.from(received, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function isSafeGitRevision(value: string): boolean {
  return /^[a-f0-9]{40,64}$/.test(value)
}

export function isUncertainGitFailure(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (!error || typeof error !== 'object') return true
  const candidate = error as { code?: unknown; killed?: unknown; signal?: unknown; name?: unknown }
  return candidate.name === 'AbortError' || candidate.code === 'ETIMEDOUT' || candidate.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || candidate.killed === true || typeof candidate.signal === 'string'
}

export function validatePatch(
  patchText: string,
  proposal: ChangeProposal,
  session: AnalysisSession,
  config: RepoAtlasConfig,
  limits: ChangeProposalLimits,
): { parsed: ParsedPatch } | { parsed?: undefined; reason: string } {
  if (typeof patchText !== 'string' || !patchText.trim()) return { reason: 'patch text is required' }
  const canonicalText = patchText.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  if (canonicalText.includes('\0')) return { reason: 'patch text contains a NUL byte' }
  const normalizedText = canonicalText.endsWith('\n') ? canonicalText : `${canonicalText}\n`
  if (Buffer.byteLength(normalizedText) > limits.maxPatchBytes) return { reason: 'patch byte budget exhausted' }
  const secretCheck = redactSecretLike(normalizedText)
  if (secretCheck.redacted) return { reason: 'patch text contains secret-like content and was rejected' }
  const parsed = parsePatchText(normalizedText, limits)
  if (!parsed.parsed) return parsed

  const targetMap = new Map(proposal.targets.filter((target) => target.status === 'confirmed').map((target) => [target.relativePath, target]))
  for (const file of parsed.parsed.summary.files) {
    const check = checkWorkspacePath(proposal.workspaceRoot, file.relativePath)
    if (!check.allowed) return { reason: `${file.relativePath}: ${check.reason}` }
    if (isSensitivePath(file.relativePath, config.sensitiveFilePatterns)) return { reason: `${file.relativePath}: sensitive path is not eligible for patch application` }
    if (config.excludeDirs.includes(file.relativePath.split('/')[0] ?? '')) return { reason: `${file.relativePath}: excluded directory is not eligible for patch application` }
    if (!isPathCoveredByScope(file.relativePath, session.goal.scope)) return { reason: `${file.relativePath}: outside the confirmed GoalSpec scope` }
    const target = targetMap.get(file.relativePath)
    if (!target || target.operation !== file.operation) return { reason: `${file.relativePath}: patch operation is not covered by the confirmed proposal target` }
  }
  return parsed
}

export function parsePatchText(patchText: string, limits: ChangeProposalLimits): { parsed: ParsedPatch } | { parsed?: undefined; reason: string } {
  const lines = patchText.slice(-1) === '\n' ? patchText.slice(0, -1).split('\n') : patchText.split('\n')
  if (!lines.length || !lines[0]?.startsWith('diff --git ')) return { reason: 'patch must start with a supported diff --git header' }
  for (const line of lines) {
    if (Buffer.byteLength(line) > limits.maxPatchLineBytes) return { reason: 'patch line-length budget exhausted' }
  }
  const starts = lines.flatMap((line, index) => line.startsWith('diff --git ') ? [index] : [])
  if (starts.length === 0 || starts[0] !== 0) return { reason: 'patch contains unsupported content before the first diff block' }
  if (starts.length > limits.maxPatchFiles) return { reason: 'patch file budget exhausted' }

  const files: ChangeProposalPatchFileSummary[] = []
  let totalHunks = 0
  for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
    const start = starts[blockIndex] ?? 0
    const end = starts[blockIndex + 1] ?? lines.length
    const block = lines.slice(start, end)
    const header = (block[0] ?? '').match(/^diff --git a\/(.+) b\/(.+)$/)
    if (!header || header[1] !== header[2]) return { reason: 'patch contains unsupported rename, copy, or quoted diff header' }
    if (block.some((line) => /^(?:Binary files|GIT binary patch|rename from |rename to |copy from |copy to |similarity index |old mode |new mode |Subproject commit )/.test(line))) {
      return { reason: 'patch contains unsupported binary, rename, mode, or submodule metadata' }
    }
    const oldHeader = block.find((line) => line.startsWith('--- '))
    const newHeader = block.find((line) => line.startsWith('+++ '))
    const oldPath = parsePatchPath(oldHeader, '--- ', 'a/')
    const newPath = parsePatchPath(newHeader, '+++ ', 'b/')
    if (oldPath === undefined || newPath === undefined || (oldPath === null && newPath === null)) return { reason: 'patch has invalid unified-diff file headers' }
    const relativePath = oldPath ?? newPath
    if (relativePath !== header[1]) return { reason: 'patch diff header and unified file header do not match' }
    const operation: ChangeProposalOperation = oldPath === null ? 'add' : newPath === null ? 'delete' : 'modify'
    if (block.some((line) => line.startsWith('new file mode ')) && operation !== 'add') return { reason: 'new file metadata does not match patch operation' }
    if (block.some((line) => line.startsWith('deleted file mode ')) && operation !== 'delete') return { reason: 'deleted file metadata does not match patch operation' }

    let hunks = 0
    let additions = 0
    let deletions = 0
    let inHunk = false
    for (const line of block.slice(Math.max(block.indexOf(newHeader ?? ''), 0) + 1)) {
      if (line.startsWith('@@ ')) {
        if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: .*)?$/.test(line)) return { reason: 'patch contains an invalid hunk header' }
        hunks += 1
        totalHunks += 1
        if (totalHunks > limits.maxPatchHunks) return { reason: 'patch hunk budget exhausted' }
        inHunk = true
        continue
      }
      if (!inHunk) {
        if (line.startsWith('index ') || line.startsWith('new file mode ') || line.startsWith('deleted file mode ')) continue
        return { reason: 'patch contains unsupported metadata' }
      }
      if (line === '\\ No newline at end of file') continue
      if (line.startsWith('+')) additions += 1
      else if (line.startsWith('-')) deletions += 1
      else if (line.startsWith(' ')) continue
      else return { reason: 'patch contains an unsupported hunk line' }
    }
    if (hunks === 0) return { reason: 'patch file has no hunks' }
    files.push({ relativePath, operation, additions, deletions, hunks })
  }
  const duplicate = files.find((file, index) => files.findIndex((candidate) => candidate.relativePath === file.relativePath) !== index)
  if (duplicate) return { reason: `patch contains a duplicate target: ${duplicate.relativePath}` }
  return {
    parsed: {
      canonicalText: patchText,
      summary: {
        bytes: Buffer.byteLength(patchText),
        files,
        hunks: totalHunks,
        changedLines: files.reduce((total, file) => total + file.additions + file.deletions, 0),
      },
    },
  }
}

export function parsePatchPath(line: string | undefined, marker: string, prefix: string): string | null | undefined {
  if (!line?.startsWith(marker)) return undefined
  const value = line.slice(marker.length).split('\t', 1)[0] ?? ''
  if (value === '/dev/null') return null
  if (!value.startsWith(prefix) || value.length <= prefix.length) return undefined
  return value.slice(prefix.length)
}

export function createPatchDigest(proposal: ChangeProposal, patch: ChangeProposalPatch, patchText: string): string {
  const payload = JSON.stringify({
    patchId: patch.patchId,
    proposalId: proposal.proposalId,
    proposalDigest: proposal.confirmationDigest,
    baseRevision: proposal.baseRevision,
    worktreeIdentity: proposal.worktree?.identity,
    summary: patch.summary,
    patchText,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export function createCommitDigest(proposal: ChangeProposal, commit: ChangeProposalCommit, expectedWorkspacePaths: readonly string[]): string {
  const payload = JSON.stringify({
    commitId: commit.commitId,
    proposalId: proposal.proposalId,
    patchId: proposal.patch?.patchId,
    patchDigest: proposal.patch?.confirmationDigest,
    verificationId: proposal.patch?.verification?.verificationId,
    verificationStatus: proposal.patch?.verification?.status,
    baseRevision: proposal.baseRevision,
    worktreeIdentity: proposal.worktree?.identity,
    expectedWorkspacePaths: [...expectedWorkspacePaths].sort(),
    commitMessage: commit.message,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export function createLandingDigest(proposal: ChangeProposal, landing: ChangeProposalLanding): string {
  const payload = JSON.stringify({
    landingId: landing.landingId,
    proposalId: proposal.proposalId,
    commitId: proposal.commit?.commitId,
    commitDigest: proposal.commit?.confirmationDigest,
    commitRevision: landing.commitRevision,
    sourcePath: path.resolve(landing.sourcePath),
    sourceRevision: landing.sourceRevision,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  return [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0')
}

export function clonePatchSummary(summary: ChangeProposalPatchSummary): ChangeProposalPatchSummary {
  return {
    ...summary,
    files: summary.files.map((file) => ({ ...file })),
  }
}

export function boundVerification(verification: ChangeProposalVerification, maxBytes: number): ChangeProposalVerification {
  return {
    ...verification,
    reason: boundedRedactedText(verification.reason, maxBytes),
    stdout: boundedRedactedText(verification.stdout, maxBytes),
    stderr: boundedRedactedText(verification.stderr, maxBytes),
  }
}

export function workspaceRelativeRoot(proposal: ChangeProposal): string {
  const relative = path.relative(path.resolve(proposal.repositoryRoot), path.resolve(proposal.workspaceRoot))
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('proposal workspace is outside the repository root')
  return relative
}

export function workspaceChangedPaths(proposal: ChangeProposal, inspected: InspectedWorktree): string[] {
  const relativeRoot = workspaceRelativeRoot(proposal)
  const worktreeWorkspace = path.resolve(inspected.path, relativeRoot || '.')
  const result: string[] = []
  for (const repositoryPath of inspected.changedPaths) {
    const absolute = path.resolve(inspected.path, repositoryPath)
    if (!isWithin(worktreeWorkspace, absolute)) return [repositoryPath]
    result.push(path.relative(worktreeWorkspace, absolute).replaceAll(path.sep, '/'))
  }
  return uniquePaths(result)
}

export function repositoryRelativePaths(proposal: ChangeProposal): string[] {
  if (!proposal.patch) throw new Error('proposal has no patch')
  const repositoryRoot = path.resolve(proposal.repositoryRoot)
  const workspaceRoot = path.resolve(proposal.workspaceRoot)
  const paths = proposal.patch.summary.files.map((file) => {
    const absolute = path.resolve(workspaceRoot, file.relativePath)
    if (!isWithin(workspaceRoot, absolute) || !isWithin(repositoryRoot, absolute) || absolute === repositoryRoot) throw new Error(`invalid repository path: ${file.relativePath}`)
    const relative = path.relative(repositoryRoot, absolute).replaceAll(path.sep, '/')
    if (!isSafeRepositoryRelativePath(relative)) throw new Error(`invalid repository path: ${file.relativePath}`)
    return relative
  })
  return uniquePaths(paths)
}

export function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0).map((value) => value.replaceAll('\\', '/')))]
}

export function isSafeRepositoryRelativePath(value: string): boolean {
  return value.length > 0 && value !== '.' && !value.startsWith('/') && value !== '..' && !value.startsWith('../') && !value.includes('\0')
}

export function normalizeCommitMessage(value: unknown, maxBytes: number): { value?: string; reason: string } {
  if (typeof value !== 'string' || !value.trim()) return { reason: 'a non-empty commit message is required' }
  const message = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim()
  if (message.includes('\0')) return { reason: 'commit message contains a NUL byte' }
  if (Buffer.byteLength(message) > maxBytes) return { reason: 'commit message byte budget exhausted' }
  if (redactSecretLike(message).redacted) return { reason: 'commit message contains secret-like content and was rejected' }
  return { value: message, reason: 'commit message is valid' }
}

export function boundedRedactedText(value: string, maxBytes: number): string {
  const redacted = redactSecretLike(value).text
  if (Buffer.byteLength(redacted) <= maxBytes) return redacted
  let result = ''
  for (const character of redacted) {
    if (Buffer.byteLength(`${result}${character}…`) > maxBytes) break
    result += character
  }
  return `${result}…`
}

export function boundedList(values: readonly string[], maxBytes: number): string[] {
  const result: string[] = []
  let bytes = 0
  for (const value of values) {
    const nextBytes = Buffer.byteLength(value)
    if (bytes + nextBytes > maxBytes) break
    result.push(value)
    bytes += nextBytes
  }
  return result
}

export function isProposalOperation(value: unknown): value is ChangeProposalOperation {
  return value === 'add' || value === 'modify' || value === 'delete'
}

export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(/(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '[REDACTED_SECRET]').slice(0, 400)
}
