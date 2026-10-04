import type { AnalysisSession, AnalysisStatus } from '../types.ts'
import { buildDependencyGraph } from './dependency-graph.ts'

export interface EvidenceHit {
  evidenceId: string
  sourcePath: string
  locator: string
  excerpt: string
  status: AnalysisStatus
  score: number
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
    const text = item.observation.toLowerCase()
    const score = terms.reduce((total, term) => total + (source.includes(term) ? 3 : 0) + (text.includes(term) ? 1 : 0), 0)
    if (!score) continue
    const positions = terms.map(term => text.indexOf(term)).filter(position => position >= 0)
    const start = positions.length ? Math.max(0, Math.min(...positions) - 80) : 0
    hits.push({ evidenceId: item.evidenceId, sourcePath: item.sourcePath, locator: item.locator,
      excerpt: item.observation.slice(start, start + 600), status: item.status, score })
  }
  hits.sort((a, b) => b.score - a.score || a.sourcePath.localeCompare(b.sourcePath) || a.locator.localeCompare(b.locator))
  return { ...snapshotMetadata(session), totalMatches: hits.length, truncated: hits.length > limit, hits: hits.slice(0, limit) }
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
