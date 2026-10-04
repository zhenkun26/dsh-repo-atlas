import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { buildDependencyGraph, resolveLocalImport } from '../src/repository/dependency-graph.ts'
import { analyzeImpact, searchEvidence } from '../src/repository/intelligence.ts'
import { analyzeRepository } from '../src/repository/analyze.ts'
import { parseAstSource } from '../src/repository/ast-parser.ts'
import { createGoalSpec, resolveStart } from '../src/clarification/goal.ts'
import { apply } from '../src/harness/plugin.ts'
import type { AnalysisSession, Evidence, ScannedFile } from '../src/types.ts'
import type { HarnessTool, HarnessToolExecution } from '../src/harness/public.ts'

const root = path.join(process.cwd(), 'test/fixtures/complete-repo')
const file = (relativePath: string): ScannedFile => ({ relativePath, kind: 'text', sizeBytes: 1 })
const evidence = (sourcePath: string, moduleSpecifier: string, evidenceId: string, compiler = true): Evidence => ({
  evidenceId, sourcePath, locator: '1:1', observation: `import from ${moduleSpecifier}`, status: 'syntax-confirmed',
  redactionState: 'clean', evidenceKind: 'ast', astParser: compiler ? 'typescript-compiler' : 'bounded-structural',
  astObservation: { kind: 'import', moduleSpecifier, line: 1, column: 1, summary: 'import' },
})
async function snapshot(): Promise<AnalysisSession> {
  return analyzeRepository(resolveStart(createGoalSpec({ intent: 'onboarding' }), 'direct'), root)
}

test('local import resolution handles emitted extensions and indexes without prefix guesses', () => {
  const files = new Set(['src/main.ts', 'src/lib.ts', 'src/lib.test.ts', 'src/utils/helper.ts', 'src/dir/index.ts', 'src/mod.mts'])
  assert.equal(resolveLocalImport('src/main.ts', './lib', files), 'src/lib.ts')
  assert.equal(resolveLocalImport('src/main.ts', './lib.js', files), 'src/lib.ts')
  assert.equal(resolveLocalImport('src/main.ts', './dir', files), 'src/dir/index.ts')
  assert.equal(resolveLocalImport('src/main.ts', './mod.mjs', files), 'src/mod.mts')
  assert.equal(resolveLocalImport('src/main.ts', './utils', files), undefined)
  assert.equal(resolveLocalImport('src/main.ts', '../../secret', files), undefined)
  assert.equal(resolveLocalImport('src/main.ts', '@/lib', files), undefined)
  files.add('src/lib.js')
  assert.equal(resolveLocalImport('src/main.ts', './lib', files), undefined)
  assert.equal(resolveLocalImport('src/main.ts', './lib.js', files), 'src/lib.js')
})

test('graph distinguishes parser provenance, re-exports, and unresolved imports', () => {
  const entries = [evidence('src/main.ts', './lib', 'e1', false), evidence('src/lib.ts', './missing', 'e2'), evidence('src/lib.ts', 'external', 'e3')]
  entries[0].astObservation!.kind = 'export'
  const graph = buildDependencyGraph([file('src/main.ts'), file('src/lib.ts')], entries)
  assert.equal(graph.edges[0].status, 'inferred')
  assert.equal(graph.edges[0].to, 'src/lib.ts')
  assert.deepEqual(graph.unresolved.map(item => item.reason).sort(), ['external-or-alias', 'outside-snapshot-or-ambiguous'])
  assert.equal(buildDependencyGraph([file('src/lib.ts')], entries).edges.length, 0)
  const confirmed = buildDependencyGraph([file('src/main.ts'), file('src/lib.ts')], [
    ...entries, evidence('src/main.ts', './lib', 'compiler'),
  ])
  assert.equal(confirmed.edges[0].status, 'syntax-confirmed')
  assert.deepEqual(confirmed.edges[0].evidenceIds, ['e1', 'compiler'])
})

test('exported string initializers do not become dependency declarations', () => {
  const parsed = parseAstSource('src/main.ts', "export const target = './fake'\nexport { real } from './real'\n", {
    maxTokens: 100, maxObservations: 20, maxObservationTextBytes: 240,
  })
  assert.ok(parsed.observations.some(item => item.kind === 'export' && item.moduleSpecifier === './real'))
  assert.ok(parsed.observations.every(item => item.moduleSpecifier !== './fake'))
})

test('impact traces reverse imports with evidence chains, cycle protection, and depth limits', async () => {
  const session = await snapshot()
  session.scan.files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(file)
  session.evidence = [evidence('a.ts', './b', 'ab'), evidence('b.ts', './c', 'bc'), evidence('c.ts', './a', 'ca'), evidence('d.ts', './a', 'da')]
  const result = analyzeImpact(session, ['c.ts'], 3)
  assert.deepEqual(result.affected.map(item => item.sourcePath), ['b.ts', 'a.ts', 'd.ts'])
  assert.deepEqual(result.affected[2].evidenceIds, ['bc', 'ab', 'da'])
  assert.equal(result.truncated, false)
  assert.equal(analyzeImpact(session, ['c.ts'], 1).truncated, true)
  assert.equal(analyzeImpact(session, ['c.ts'], 3, 1).affected.length, 1)
  assert.deepEqual(analyzeImpact(session, ['missing.ts']).unknownTargets, ['missing.ts'])
  assert.throws(() => analyzeImpact(session, ['../secret']))
  assert.throws(() => analyzeImpact(session, ['C:/secret']))
  assert.throws(() => analyzeImpact(session, ['c.ts'], 11))
})

test('evidence retrieval is literal, bounded, redacted, detached, and snapshot-labelled', async () => {
  const session = await snapshot()
  const result = searchEvidence(session, 'server', 1)
  assert.equal(result.freshness, 'snapshot-not-revalidated')
  assert.equal(result.hits.length, 1)
  assert.ok(result.totalMatches >= 1)
  const original = session.evidence.find(item => item.evidenceId === result.hits[0].evidenceId)!
  result.hits[0].excerpt = 'mutated'
  assert.notEqual(original.observation, 'mutated')
  assert.throws(() => searchEvidence(session, '.*'))
  assert.throws(() => searchEvidence(session, 'server', 51))
  const sensitive = await analyzeRepository(resolveStart(createGoalSpec(), 'direct'), path.join(process.cwd(), 'test/fixtures/sensitive-repo'))
  assert.doesNotMatch(JSON.stringify(searchEvidence(sensitive, 'REDACTED')), /sk-testvalue1234567890/)
})

test('Harness queries require prior analysis in the exact live session and preserve cancellation', async () => {
  const tools: HarnessTool[] = []
  apply({ tools: { register: tool => tools.push(tool) } })
  const analyze = tools.find(tool => tool.name === 'repo_atlas_analyze')!
  const search = tools.find(tool => tool.name === 'repo_atlas_search')!
  const impact = tools.find(tool => tool.name === 'repo_atlas_impact')!
  const owner: HarnessToolExecution = { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal }
  const other: HarnessToolExecution = { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal }
  assert.ok((await search.execute({ query: 'server' }, owner) as { blocked: unknown }).blocked)
  await analyze.execute({ start: 'direct' }, owner)
  const found = await search.execute({ query: 'server' }, owner) as { result: { hits: unknown[] } }
  assert.ok(found.result.hits.length)
  assert.ok((await search.execute({ query: 'server' }, other) as { blocked: unknown }).blocked)
  const impacted = await impact.execute({ targets: ['src/server.ts'] }, owner) as { result: { affected: unknown[] } }
  assert.ok(impacted.result.affected.length)
  assert.ok((await impact.execute({ targets: ['../secret'] }, owner) as { blocked: unknown }).blocked)
  assert.ok((await search.execute({ query: 'server', unexpected: true }, owner) as { blocked: unknown }).blocked)
  assert.ok((await search.execute({ query: 'server' }, { ...owner, signal: AbortSignal.abort() }) as { blocked: unknown }).blocked)
  await analyze.execute({ start: 'direct', goal: { scope: ['src/web'] } }, owner)
  const replaced = await impact.execute({ targets: ['src/server.ts'] }, owner) as { result: { unknownTargets: string[] } }
  assert.deepEqual(replaced.result.unknownTargets, ['src/server.ts'])
  owner.agent!.session.header!.cwd = path.dirname(root)
  assert.ok((await search.execute({ query: 'server' }, owner) as { blocked: unknown }).blocked)
})
