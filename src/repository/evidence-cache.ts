import path from 'node:path'
import { createHash } from 'node:crypto'
import { EVIDENCE_CACHE_SCHEMA_VERSION, type Evidence, type EvidenceCache, type EvidenceCacheEntry, type EvidenceFingerprint, type RepoAtlasConfig, type ScannedFile } from '../types.ts'

export type EvidenceCacheIncompatibilityReason =
  | 'missing-cache'
  | 'malformed-cache'
  | 'schema-version'
  | 'workspace-root'
  | 'policy'
  | 'reader'
  | 'ignore-policy'

export interface EvidenceCacheCompatibility {
  compatible: boolean
  reason?: EvidenceCacheIncompatibilityReason
}

export interface EvidenceReuseSelection {
  evidence: Evidence[]
  reusedPaths: string[]
  rereadPaths: string[]
  invalidatedPaths: string[]
  newPaths: string[]
  removedPaths: string[]
  uncoveredPaths: string[]
}

export interface EvidenceReuseSelectionOptions {
  /** Whether the discovery result covers every path in the requested scope. */
  discoveryComplete?: boolean
  /** A confirmed follow-up scope forces a fresh read for covered paths. */
  forceScopeReread?: boolean
  readerIdentity?: string
  requireSourceMaterial?: boolean
  ignoreFingerprint?: string
}

export function createEvidenceCache(config: RepoAtlasConfig, entries: EvidenceCacheEntry[] = [], readerIdentity = 'local-node', ignoreFingerprint = ''): EvidenceCache {
  return {
    schemaVersion: EVIDENCE_CACHE_SCHEMA_VERSION,
    workspaceRoot: path.resolve(config.workspaceRoot),
    policyFingerprint: createEvidencePolicyFingerprint(config),
    readerIdentity,
    ignoreFingerprint,
    entries: entries.map((entry) => ({
      ...entry,
      fingerprint: { ...entry.fingerprint },
      coverage: [...entry.coverage],
      evidence: entry.evidence.map(item => structuredClone(item)),
      sourceMaterial: entry.sourceMaterial ? { ...entry.sourceMaterial } : undefined,
    })),
  }
}

export function createEvidencePolicyFingerprint(config: RepoAtlasConfig): string {
  return JSON.stringify({
    excludeDirs: [...config.excludeDirs].map(normalizePolicyValue).sort(),
    sensitiveFilePatterns: [...config.sensitiveFilePatterns].map(normalizePolicyValue).sort(),
    maxCandidateFiles: config.maxCandidateFiles,
    maxFileBytes: config.maxFileBytes,
    maxTotalBytes: config.maxTotalBytes,
    maxActions: config.maxActions,
    maxAstFiles: config.maxAstFiles,
    maxAstTokensPerFile: config.maxAstTokensPerFile,
    maxAstObservationsPerFile: config.maxAstObservationsPerFile,
    maxAstObservationTextBytes: config.maxAstObservationTextBytes,
    cacheValidation: config.cacheValidation,
    respectGitIgnore: config.respectGitIgnore,
  })
}

export function checkEvidenceCacheCompatibility(cache: EvidenceCache | undefined, config: RepoAtlasConfig, readerIdentity = 'local-node', ignoreFingerprint = ''): EvidenceCacheCompatibility {
  if (!cache) return { compatible: false, reason: 'missing-cache' }
  if (!Array.isArray(cache.entries) || typeof cache.workspaceRoot !== 'string' || typeof cache.policyFingerprint !== 'string') {
    return { compatible: false, reason: 'malformed-cache' }
  }
  if (cache.schemaVersion !== EVIDENCE_CACHE_SCHEMA_VERSION) return { compatible: false, reason: 'schema-version' }
  if (cache.readerIdentity !== readerIdentity) return { compatible: false, reason: 'reader' }
  if (cache.ignoreFingerprint !== ignoreFingerprint) return { compatible: false, reason: 'ignore-policy' }
  if (path.resolve(cache.workspaceRoot) !== path.resolve(config.workspaceRoot)) return { compatible: false, reason: 'workspace-root' }
  if (cache.policyFingerprint !== createEvidencePolicyFingerprint(config)) return { compatible: false, reason: 'policy' }
  return { compatible: true }
}

export function getCompatibleEvidenceCache(cache: EvidenceCache | undefined, config: RepoAtlasConfig, readerIdentity = 'local-node', ignoreFingerprint = ''): EvidenceCache | undefined {
  return checkEvidenceCacheCompatibility(cache, config, readerIdentity, ignoreFingerprint).compatible ? cache : undefined
}

export function selectReusableEvidence(
  files: ScannedFile[],
  cache: EvidenceCache | undefined,
  config: RepoAtlasConfig,
  options: EvidenceReuseSelectionOptions = {},
): EvidenceReuseSelection {
  const compatibleCache = getCompatibleEvidenceCache(cache, config, options.readerIdentity, options.ignoreFingerprint)
  const entries = new Map(
    compatibleCache?.entries
      .filter((entry) => isUsableCacheEntry(entry))
      .map((entry) => [entry.fingerprint.relativePath, entry])
      ?? [],
  )
  const evidence: Evidence[] = []
  const reusedPaths: string[] = []
  const rereadPaths: string[] = []
  const invalidatedPaths: string[] = []
  const newPaths: string[] = []
  const removedPaths: string[] = []
  const uncoveredPaths: string[] = []
  const discoveredPaths = new Set<string>()
  const scope = normalizeEvidenceScope(config.scope)

  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath)
    if (!relativePath) continue
    discoveredPaths.add(relativePath)
    const entry = entries.get(relativePath)
    const readable = file.kind === 'text' || file.kind === 'unreadable'
    if (!readable) {
      if (entry) invalidatedPaths.push(relativePath)
      else newPaths.push(relativePath)
      uncoveredPaths.push(relativePath)
      continue
    }
    if (!entry) {
      newPaths.push(relativePath)
      rereadPaths.push(relativePath)
      continue
    }
    if (!file.fingerprint || !fingerprintsEqual(entry.fingerprint, file.fingerprint)) {
      invalidatedPaths.push(relativePath)
      rereadPaths.push(relativePath)
      continue
    }
    if (options.requireSourceMaterial && !hasValidSourceMaterial(entry)) {
      invalidatedPaths.push(relativePath)
      rereadPaths.push(relativePath)
      continue
    }
    if (shouldForceScopeReread(entry, scope, options.forceScopeReread) && isPathCoveredByScope(relativePath, scope)) {
      rereadPaths.push(relativePath)
      continue
    }
    if (entry.evidence.length) {
      evidence.push(...entry.evidence.map(item => structuredClone(item)))
    }
    reusedPaths.push(relativePath)
  }

  for (const entry of entries.values()) {
    const relativePath = entry.fingerprint.relativePath
    if (discoveredPaths.has(relativePath)) continue
    if (isPathCoveredByScope(relativePath, scope)) {
      if (options.discoveryComplete !== false) removedPaths.push(relativePath)
      else {
        evidence.push(...entry.evidence.map(item => structuredClone(item)))
        reusedPaths.push(relativePath)
        uncoveredPaths.push(relativePath)
      }
      continue
    }
    evidence.push(...entry.evidence.map(item => structuredClone(item)))
    reusedPaths.push(relativePath)
    uncoveredPaths.push(relativePath)
  }

  return {
    evidence,
    reusedPaths: uniquePaths(reusedPaths),
    rereadPaths: uniquePaths(rereadPaths),
    invalidatedPaths: uniquePaths(invalidatedPaths),
    newPaths: uniquePaths(newPaths),
    removedPaths: uniquePaths(removedPaths),
    uncoveredPaths: uniquePaths(uncoveredPaths),
  }
}

export function hasValidSourceMaterial(entry: EvidenceCacheEntry): boolean {
  const source = entry.sourceMaterial
  return Boolean(source && typeof source.text === 'string' && source.redactedContentSha256 === createHash('sha256').update(source.text).digest('hex') &&
    entry.evidence.some(item => item.evidenceId === source.evidenceId && item.sourcePath === entry.fingerprint.relativePath && item.status === 'confirmed'))
}

/**
 * Remove stale evidence before adding the results of a fresh read. This is
 * intentionally pure and session-local; callers decide which paths were
 * confirmed by discovery and which read results are safe to promote.
 */
export function replaceEvidenceForPaths(
  currentEvidence: readonly Evidence[],
  replacementEvidence: readonly Evidence[],
  replacedPaths: readonly string[] = [],
): Evidence[] {
  const pathsToReplace = new Set([
    ...replacedPaths.map(normalizeRelativePath).filter((value): value is string => value !== undefined),
    ...replacementEvidence.map((item) => normalizeRelativePath(item.sourcePath)).filter((value): value is string => value !== undefined),
  ])
  return [
    ...currentEvidence.filter((item) => !pathsToReplace.has(normalizeRelativePath(item.sourcePath) ?? item.sourcePath)).map((item) => ({ ...item })),
    ...replacementEvidence.map((item) => ({ ...item })),
  ]
}

export function normalizeEvidenceScope(scope?: readonly string[]): string[] {
  if (!scope || scope.length === 0) return ['.']
  return [...new Set(scope.map(normalizeRelativePath).filter((value): value is string => value !== undefined))]
}

export function isPathCoveredByScope(relativePath: string, scope?: readonly string[]): boolean {
  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return false
  return normalizeEvidenceScope(scope).some((scopePath) => scopePath === '.' || normalizedPath === scopePath || normalizedPath.startsWith(`${scopePath}/`))
}

export function isCacheEntryPathCoveredByScope(entry: EvidenceCacheEntry, scope?: readonly string[]): boolean {
  return isPathCoveredByScope(entry.fingerprint.relativePath, scope)
}

function fingerprintsEqual(left: EvidenceCacheEntry['fingerprint'], right: ScannedFile['fingerprint']): boolean {
  return right !== undefined
    && left.relativePath === right.relativePath
    && left.sizeBytes === right.sizeBytes
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.version === right.version
}

function isUsableCacheEntry(entry: EvidenceCacheEntry): boolean {
  return Boolean(entry)
    && isValidFingerprint(entry.fingerprint)
    && Array.isArray(entry.coverage)
    && Array.isArray(entry.evidence)
}

function isValidFingerprint(fingerprint: unknown): fingerprint is EvidenceFingerprint {
  if (!fingerprint || typeof fingerprint !== 'object') return false
  const candidate = fingerprint as Partial<EvidenceFingerprint>
  return typeof candidate.relativePath === 'string'
    && normalizeRelativePath(candidate.relativePath) === candidate.relativePath
    && [candidate.sizeBytes, candidate.mtimeMs, candidate.ctimeMs].every(Number.isFinite)
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)]
}

function shouldForceScopeReread(entry: EvidenceCacheEntry, currentScope: readonly string[], override?: boolean): boolean {
  if (override !== undefined) return override
  const previousScope = normalizeEvidenceScope(entry.coverage)
  return !scopesEqual(previousScope, currentScope) && scopeIsWithin(previousScope, currentScope)
}

function scopeIsWithin(outerScope: readonly string[], innerScope: readonly string[]): boolean {
  return innerScope.every((innerPath) => outerScope.some((outerPath) => outerPath === '.' || outerPath === innerPath || innerPath.startsWith(`${outerPath}/`)))
}

function scopesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/')).replace(/\/+$/, '') || '.'
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) return undefined
  return normalized === '.' ? '.' : normalized.replace(/^\.\//, '')
}

function normalizePolicyValue(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase()
}
