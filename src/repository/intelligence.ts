import type { AnalysisSession, AnalysisStatus } from '../types.ts'
import { buildDependencyGraph } from './dependency-graph.ts'

export interface EvidenceHit {
  evidenceId: string
  sourcePath: string
  locator: string
  excerpt: string
  status: AnalysisStatus
  score: number
  sourceValidation?: 'read-and-version-checked' | 'metadata-reused' | 'not-revalidated'
}

/** Literal lexical retrieval; repository content is data, never an instruction. */
export function searchEvidence(session: AnalysisSession, query: string, limit = 10) {
  boundedInteger(limit, 1, 50, 'limit')
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('query must contain 1 to 500 characters')
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_$./-]+/gu) ?? []).filter(term => /[\p{L}\p{N}_$]/u.test(term)))].slice(0, 20)
  if (!terms.length) throw new Error('query must contain searchable text')
  const hits: EvidenceHit[] = []
  for (const item of session.evidence) {
    if (!['confirmed', 'syntax-confirmed', 'inferred'].includes(item.status)) continue
    const source = item.sourcePath.toLowerCase()
    const material = session.sourceSnapshots?.get(item.sourcePath)
    const observation = material?.evidenceId === item.evidenceId ? material.text : item.observation
    const text = observation.toLowerCase()
    const score = terms.reduce((total, term) => total + (source.includes(term) ? 3 : 0) + (text.includes(term) ? 1 : 0), 0)
    if (!score) continue
    const positions = terms.map(term => text.indexOf(term)).filter(position => position >= 0)
    const matchPosition = positions.length ? originalOffset(observation, text, Math.min(...positions)) : 0
    const start = positions.length ? Math.max(0, matchPosition - 80) : 0
    hits.push({ evidenceId: item.evidenceId, sourcePath: item.sourcePath, locator: item.locator,
      excerpt: observation.slice(start, start + 600), status: item.status, score,
      ...(material ? { sourceValidation: material.validation } : {}),
      ...(material?.evidenceId === item.evidenceId && positions.length ? { locator: `第 ${observation.slice(0, matchPosition).split('\n').length} 行` } : {}) })
  }
  hits.sort((a, b) => b.score - a.score || compareText(a.sourcePath, b.sourcePath) || compareText(a.locator, b.locator))
  const seen = new Set<string>()
  const diverse: EvidenceHit[] = []
  const remaining: EvidenceHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.sourcePath)) remaining.push(hit)
    else { diverse.push(hit); seen.add(hit.sourcePath) }
  }
  return { ...snapshotMetadata(session), ranking: 'lexical-with-file-diversity' as const, totalMatches: hits.length, truncated: hits.length > limit, hits: [...diverse, ...remaining].slice(0, limit) }
}

/** Reverse static imports express possible impact, never proof of runtime breakage. */
export function analyzeImpact(session: AnalysisSession, targets: string[], maxDepth = 3, limit = 50) {
  boundedInteger(maxDepth, 1, 10, 'maxDepth')
  boundedInteger(limit, 1, 100, 'limit')
  if (!Array.isArray(targets) || !targets.length || targets.length > 50 || targets.some(target => !safeRelativePath(target))) {
    throw new Error('targets must contain 1 to 50 repository-relative file paths without traversal')
  }
  const graph = buildDependencyGraph(session.scan.files, session.evidence)
  const observed = new Set(session.scan.files.filter(file => file.kind === 'text').map(file => file.relativePath))
  const uniqueTargets = [...new Set(targets)].sort()
  const unknownTargets = uniqueTargets.filter(target => !observed.has(target))
  const visited = new Set(uniqueTargets.filter(target => observed.has(target)))
  const queue = [...visited].map(sourcePath => ({ sourcePath, depth: 0, evidenceIds: [] as string[] }))
  const affected: Array<{ sourcePath: string; depth: number; via: string; evidenceIds: string[]; status: 'potential-impact' }> = []
  let truncated = false
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for (const edge of graph.edges.filter(candidate => candidate.to === current.sourcePath)) {
      if (visited.has(edge.from)) continue
      if (current.depth >= maxDepth || affected.length >= limit) { truncated = true; continue }
      visited.add(edge.from)
      const evidenceIds = [...new Set([...current.evidenceIds, ...edge.evidenceIds])]
      const next = { sourcePath: edge.from, depth: current.depth + 1, evidenceIds }
      affected.push({ ...next, via: current.sourcePath, status: 'potential-impact' })
      queue.push(next)
    }
  }
  return { ...snapshotMetadata(session), targets: uniqueTargets, unknownTargets, affected, truncated,
    targetCoverage: uniqueTargets.map(sourcePath => ({ sourcePath, coverage: !observed.has(sourcePath) ? 'unobserved' : session.ast?.some(item => item.relativePath === sourcePath && item.status === 'syntax-confirmed') ? 'ast-snapshot' : 'text-or-path-only' })),
    unresolvedCount: graph.unresolved.length, unresolved: graph.unresolved.slice(0, 50),
    limitations: [
      'Static file imports and re-exports only; no runtime, symbol, alias, or dynamic-import proof.',
      'Only observed files and retained evidence are covered; no matches does not prove no impact.',
      'Evidence paths are possible dependency chains, not an exhaustive enumeration of all paths.',
    ] }
}

function snapshotMetadata(session: AnalysisSession) {
  return { sessionId: session.sessionId, freshness: 'snapshot-not-revalidated' as const,
    coverage: 'bounded-analysis-snapshot' as const,
    reader: session.reader?.kind ?? 'local',
    retainedSourceFiles: session.sourceSnapshots?.size ?? 0,
    discoveryIncomplete: session.scan.failures.length > 0 || Boolean(session.scan.ignorePolicy?.unsupportedRuleCount || session.scan.ignorePolicy?.nestedPoliciesObserved),
    ignorePolicy: session.scan.ignorePolicy,
    sourceValidation: 'per-hit; metadata reuse is not a fresh content check' as const,
    interrupted: session.interrupted, budgetExhausted: session.scan.budget.exhausted }
}

function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    !/^[\\/]|^[a-z]:/i.test(value) && !/[\\\u0000-\u001f]/.test(value) &&
    value.split('/').every(part => part !== '..' && part !== '.' && part !== '')
}

function boundedInteger(value: number, min: number, max: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }

/** Lowercasing can expand Unicode characters; excerpt offsets belong to the original. */
function originalOffset(original: string, folded: string, offset: number): number {
  if (original.length === folded.length) return offset
  let originalIndex = 0
  let foldedIndex = 0
  for (const character of original) {
    foldedIndex += character.toLowerCase().length
    if (foldedIndex > offset) return originalIndex
    originalIndex += character.length
  }
  return originalIndex
}
