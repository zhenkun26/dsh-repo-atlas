import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { analyzeRepository } from '../src/repository/analyze.ts'
import { buildDependencyGraph } from '../src/repository/dependency-graph.ts'
import { analyzeImpact, searchEvidence } from '../src/repository/intelligence.ts'
import { createGoalSpec, resolveStart } from '../src/clarification/goal.ts'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { filesUnder } from './build-artifact.mjs'
import { evaluationGateFailures } from './evaluation-gates.ts'

interface EvaluationCase {
  id: string
  repository?: string
  generator?: { kind: 'chain' | 'retained-text'; fileCount?: number; paddingCharacters?: number }
  expectedEdges?: string[][]
  queries: Array<{ query: string; relevantFiles: string[] }>
  impact: { targets: string[]; affectedFiles: string[] }
  unresolved?: Array<{ sourcePath: string; moduleSpecifier: string }>
  expectBudgetExhausted: boolean
  expectCompleteCoverage?: boolean
  expectedUnknownTargets?: string[]
  forbiddenEvidenceStrings?: string[]
  forbiddenEvidencePaths?: string[]
  unsupportedRelations?: string[][]
}

const repoRoot = process.cwd()
const evaluationRoot = path.join(repoRoot, 'evaluation')
const labelsPath = path.join(evaluationRoot, 'labels.json')
const labelsText = readFileSync(labelsPath, 'utf8')
const labels = JSON.parse(labelsText) as { schemaVersion: number; provenance: unknown; cases: EvaluationCase[] }
if (labels.schemaVersion !== 1 || !Array.isArray(labels.cases)) throw new Error('Unsupported evaluation label schema')
const parent = path.join(repoRoot, '.codex', 'evaluation')
mkdirSync(parent, { recursive: true })
const runRoot = mkdtempSync(path.join(parent, 'run-'))
const sourceFingerprint = fingerprint(path.join(repoRoot, 'src'))
const results = []

for (const entry of labels.cases) {
  const repository = entry.repository ? path.resolve(evaluationRoot, entry.repository) : generateRepository(entry)
  const relative = path.relative(evaluationRoot, repository)
  if (entry.repository && (relative.startsWith('..') || path.isAbsolute(relative))) throw new Error('Corpus path escapes evaluation root')
  const started = performance.now()
  const session = await analyzeRepository(resolveStart(createGoalSpec({ intent: 'architecture' }), 'direct'), repository)
  const elapsedMs = performance.now() - started
  const graph = buildDependencyGraph(session.scan.files, session.evidence)
  const evidenceIds = new Set(session.evidence.map(item => item.evidenceId))
  const observedPaths = new Set(session.scan.files.map(item => item.relativePath))
  const expectedEdges = entry.expectedEdges ?? chainEdges(entry.generator?.fileCount ?? 0)
  const edgeMetrics = compareSets(graph.edges.map(edge => `${edge.from}->${edge.to}`), expectedEdges.map(edge => edge.join('->')))
  const retrieval = entry.queries.map(query => {
    const found = searchEvidence(session, query.query, 10)
    const files = [...new Set(found.hits.map(hit => hit.sourcePath))]
    return { query: query.query, ...compareSets(files, query.relevantFiles), returnedFiles: files,
      snapshotReferenceIntegrity: found.hits.every(hit => evidenceIds.has(hit.evidenceId) && observedPaths.has(hit.sourcePath)),
      outputBytes: Buffer.byteLength(JSON.stringify(found)), totalEvidenceMatches: found.totalMatches }
  })
  const impact = analyzeImpact(session, entry.impact.targets)
  const unresolved = compareSets(graph.unresolved.map(item => `${item.sourcePath}:${item.moduleSpecifier}`),
    (entry.unresolved ?? []).map(item => `${item.sourcePath}:${item.moduleSpecifier}`))
  const retainedEvidenceText = JSON.stringify({ evidence: session.evidence, sourceMaterial: [...(session.sourceSnapshots?.values() ?? [])] })
  const redactionPassed = (entry.forbiddenEvidenceStrings ?? []).every(value => !retainedEvidenceText.includes(value))
  const sensitivePathsExcluded = (entry.forbiddenEvidencePaths ?? []).every(value => !session.evidence.some(item => item.sourcePath === value))
  const graphReferencesValid = graph.edges.every(edge =>
    observedPaths.has(edge.from) && observedPaths.has(edge.to) && edge.evidenceIds.length > 0 &&
    edge.evidenceIds.every(id => evidenceIds.has(id))) && graph.unresolved.every(item =>
    observedPaths.has(item.sourcePath) && evidenceIds.has(item.evidenceId))
  const result = { id: entry.id, inputSha256: fingerprint(repository), edgeMetrics, retrieval, graphReferencesValid,
    unsupportedRelationsExcluded: (entry.unsupportedRelations ?? []).every(([from, to]) => !graph.edges.some(edge => edge.from === from && edge.to === to)),
    impact: { ...compareSets(impact.affected.map(item => item.sourcePath), entry.impact.affectedFiles), truncated: impact.truncated,
      unknownTargets: impact.unknownTargets, evidenceReferencesValid: impact.affected.every(item => observedPaths.has(item.sourcePath) && observedPaths.has(item.via) && item.evidenceIds.length > 0 && item.evidenceIds.every(id => evidenceIds.has(id))) },
    unresolved, redactionPassed, sensitivePathsExcluded, budgetExhausted: session.scan.budget.exhausted,
    expectedBudgetStatusMatched: session.scan.budget.exhausted === entry.expectBudgetExhausted,
    astStatuses: countValues((session.ast ?? []).map(item => item.status)),
    parserProvenance: countValues((session.ast ?? []).map(item => item.parser)),
    unsupportedLabelledRelations: entry.unsupportedRelations?.length ?? 0,
    readBytes: session.scan.budget.readBytes, actions: session.scan.budget.actions,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
  }
  results.push({ ...result, gateFailures: evaluationGateFailures(result, entry) })
}

const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  sourceSha256: sourceFingerprint, evaluatorSha256: sha256(readFileSync(new URL(import.meta.url), 'utf8')), labelsSha256: sha256(labelsText), labelProvenance: labels.provenance,
  gateModuleSha256: sha256(readFileSync(new URL('./evaluation-gates.ts', import.meta.url), 'utf8')),
  configuration: DEFAULT_CONFIG, metricsDefinition: {
    retrieval: 'Unique source files from the top 10 ranked evidence records; current ranking prefers distinct files before repeated observations. Recall against independently authored relevant-file labels.',
    graph: 'Static file-edge precision/recall against labelled resolvable relations; unsupported relations recorded separately.',
    impact: 'Recall against full labelled affected-file set using current default depth=3 and limit=50.',
    citation: 'Reference integrity within the retained snapshot; not fresh-file or line-content verification.',
    timing: 'One local synthetic run; not a stable performance benchmark.',
  }, results,
}
const reportPath = path.join(runRoot, 'report.json')
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(`Evaluation report retained at ${reportPath}`)
for (const entry of results) console.log(JSON.stringify({ case: entry.id, edgeRecall: entry.edgeMetrics.recall,
  retrievalRecall: entry.retrieval.map(query => query.recall), impactRecall: entry.impact.recall, partial: entry.budgetExhausted }))
if (results.some(entry => entry.gateFailures.length > 0)) {
  for (const entry of results.filter(entry => entry.gateFailures.length)) console.error(JSON.stringify({ case: entry.id, gateFailures: entry.gateFailures }))
  console.error('FAIL: evaluation labelled coverage or safety contract failed.')
  process.exitCode = 1
}

function generateRepository(entry: EvaluationCase): string {
  const root = path.join(runRoot, entry.id, 'repository')
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: entry.id, type: 'module' }))
  writeFileSync(path.join(root, 'README.md'), '# Generated synthetic fixture\n')
  if (entry.generator?.kind === 'chain') {
    const count = entry.generator.fileCount!
    for (let index = 1; index <= count; index++) {
      const suffix = String(index).padStart(2, '0')
      const next = String(index + 1).padStart(2, '0')
      writeFileSync(path.join(root, 'src', `f${suffix}.ts`), `${index < count ? `import './f${next}.ts'\n` : ''}export const budgetMarker${index} = ${index}\n`)
    }
  } else if (entry.generator?.kind === 'retained-text') {
    writeFileSync(path.join(root, 'src', 'index.ts'), `export const padding = '${'x'.repeat(entry.generator.paddingCharacters!)}'\n// tail-evidence-marker\n`)
  } else throw new Error(`Unsupported generator for ${entry.id}`)
  return root
}

function chainEdges(count: number): string[][] {
  return Array.from({ length: Math.max(0, count - 1) }, (_, index) => [`src/f${String(index + 1).padStart(2, '0')}.ts`, `src/f${String(index + 2).padStart(2, '0')}.ts`])
}

function compareSets(actual: string[], expected: string[]) {
  const found = new Set(actual)
  const wanted = new Set(expected)
  const matched = [...found].filter(value => wanted.has(value)).length
  return { expected: wanted.size, returned: found.size, matched,
    precision: found.size ? matched / found.size : null, recall: wanted.size ? matched / wanted.size : null,
    missing: [...wanted].filter(value => !found.has(value)), unexpected: [...found].filter(value => !wanted.has(value)) }
}

function countValues(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]))
}

function fingerprint(root: string): string {
  const hash = createHash('sha256')
  for (const file of filesUnder(root)) hash.update(file).update('\0').update(readFileSync(path.join(root, file))).update('\0')
  return hash.digest('hex')
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
