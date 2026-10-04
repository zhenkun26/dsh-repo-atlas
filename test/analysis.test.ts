import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createGoalSpec, resolveStart } from '../src/clarification/goal.ts'
import { analyzeRepository } from '../src/repository/analyze.ts'
import { generateReport, exportReportBundle } from '../src/reporting/report.ts'
import { createConfig } from '../src/config.ts'
import { refineAndAnalyze } from '../src/session.ts'
import { addConclusion } from '../src/evidence.ts'

const fixture = (...parts: string[]) => path.join(process.cwd(), 'test', 'fixtures', ...parts)

test('onboarding analysis produces evidence-backed report and structured atlas data', async () => {
  const goal = resolveStart(createGoalSpec({ intent: 'onboarding' }), 'direct')
  const session = await analyzeRepository(goal, fixture('complete-repo'))
  const report = generateReport(session)
  assert.ok(session.scan.files.length > 0)
  assert.ok(session.evidence.length > 0)
  assert.match(report.markdown, /技术栈/)
  assert.match(report.markdown, /证据索引/)
  assert.equal(report.atlas.version, '1')
})

test('architecture analysis only reports static inferred relationships', async () => {
  const goal = resolveStart(createGoalSpec({ intent: 'architecture' }), 'direct')
  const session = await analyzeRepository(goal, fixture('complete-repo'))
  const report = generateReport(session)
  assert.ok(session.actions.some((action) => action.action === 'search'))
  assert.ok(session.actions.some((action) => action.action === 'parse-ast'))
  assert.ok(session.edges.some((edge) => ['syntax-confirmed', 'inferred'].includes(edge.status) && edge.evidenceIds.length > 0))
  assert.match(report.mermaid, /flowchart TD/)
  assert.match(report.markdown, /语法确认摘要/)
  assert.ok(report.atlas.limitations.some((item) => item.includes('静态')))
})

test('follow-up analysis reuses evidence and narrows discovery scope', async () => {
  const goal = resolveStart(createGoalSpec({ intent: 'onboarding' }), 'direct')
  const session = await analyzeRepository(goal, fixture('complete-repo'))
  const refined = await refineAndAnalyze(session, { intent: 'architecture', scope: ['src'], confirmed: true })
  assert.equal(refined.workspaceRoot, fixture('complete-repo'))
  assert.ok(refined.evidence.length >= session.evidence.length)
  assert.ok(refined.scan.files.every((file) => file.relativePath.startsWith('src/')))
})

test('analysis owns a session-only cache and reports incremental reuse in structured and Markdown output', async () => {
  const goal = resolveStart(createGoalSpec({ intent: 'onboarding' }), 'direct')
  const session = await analyzeRepository(goal, fixture('complete-repo'))
  const refined = await refineAndAnalyze(session, { intent: 'architecture', scope: ['src'], confirmed: true })
  const report = generateReport(refined)

  assert.equal(refined.incrementalSummary?.mode, 'incremental')
  assert.ok(refined.evidenceCache)
  assert.ok(refined.incrementalSummary?.reused.includes('README.md'))
  assert.ok(refined.incrementalSummary?.reread.includes('src/index.ts'))
  assert.equal(refined.actions.some((action) => action.action === 'read' && action.input === 'README.md'), false)
  assert.equal(refined.actions.some((action) => action.action === 'read' && action.input === 'package.json'), false)
  assert.ok(refined.actions.some((action) => action.action === 'parse-ast' && action.input.startsWith('src/')))
  assert.ok(refined.ast?.some((item) => item.relativePath === 'src/index.ts' && item.parser === 'bounded-structural'))
  assert.equal(report.incrementalSummary?.mode, 'incremental')
  assert.match(report.markdown, /增量证据摘要/)
  assert.match(report.markdown, /reused：/)
})

test('changed and deleted paths replace stale evidence and remove stale architecture inputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-atlas-incremental-'))
  try {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'README.md'), '# Incremental fixture\n', 'utf8')
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"incremental-fixture"}\n', 'utf8')
    await fs.writeFile(path.join(root, 'src', 'index.ts'), "import { server } from './server.ts'\nexport const value = server\n", 'utf8')
    await fs.writeFile(path.join(root, 'src', 'server.ts'), 'export const server = true\n', 'utf8')

    const goal = resolveStart(createGoalSpec({ intent: 'architecture' }), 'direct')
    const first = await analyzeRepository(goal, root)
    const oldIndexIds = new Set(first.evidence.filter((item) => item.sourcePath === 'src/index.ts').map((item) => item.evidenceId))
    const oldAstIds = new Set(first.evidence.filter((item) => item.sourcePath === 'src/index.ts' && item.evidenceKind === 'ast').map((item) => item.evidenceId))
    await fs.writeFile(path.join(root, 'src', 'index.ts'), "export const value = 'changed content'\n", 'utf8')
    await fs.rm(path.join(root, 'src', 'server.ts'))

    const refined = await refineAndAnalyze(first, { intent: 'architecture', scope: ['.'], confirmed: true })
    const newIndexIds = refined.evidence.filter((item) => item.sourcePath === 'src/index.ts').map((item) => item.evidenceId)

    assert.ok(refined.incrementalSummary?.invalidated.includes('src/index.ts'))
    assert.ok(refined.incrementalSummary?.invalidated.includes('src/server.ts'))
    assert.ok(refined.incrementalSummary?.reread.includes('src/index.ts'))
    assert.equal(refined.evidence.some((item) => item.sourcePath === 'src/server.ts'), false)
    assert.ok(newIndexIds.every((id) => !oldIndexIds.has(id)))
    assert.ok(refined.evidence.filter((item) => item.sourcePath === 'src/index.ts' && item.evidenceKind === 'ast').every((item) => !oldAstIds.has(item.evidenceId)))
    assert.ok(refined.evidence.some((item) => item.sourcePath === 'src/index.ts' && item.observation.includes('changed content')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('scope expansion reuses previously analyzed paths and reads only the new coverage', async () => {
  const firstGoal = resolveStart(createGoalSpec({ intent: 'architecture', scope: ['src'] }), 'direct')
  const first = await analyzeRepository(firstGoal, fixture('complete-repo'))
  const expanded = await refineAndAnalyze(first, { intent: 'architecture', scope: ['.'], confirmed: true })

  assert.ok(expanded.incrementalSummary?.reused.includes('src/index.ts'))
  assert.ok(expanded.incrementalSummary?.new.includes('package.json'))
  assert.equal(expanded.actions.some((action) => action.action === 'read' && action.input === 'src/index.ts'), false)
  assert.equal(expanded.actions.some((action) => action.action === 'parse-ast' && action.input === 'src/index.ts'), false)
  assert.ok(expanded.ast?.some((item) => item.relativePath === 'src/index.ts' && item.parser === 'cache'))
  assert.equal(expanded.actions.some((action) => action.action === 'read' && action.input === 'package.json'), true)
})

test('an incompatible cache is ignored instead of promoting prior evidence', async () => {
  const goal = resolveStart(createGoalSpec({ intent: 'onboarding' }), 'direct')
  const first = await analyzeRepository(goal, fixture('complete-repo'))
  const staleCache = { ...first.evidenceCache!, policyFingerprint: 'stale-policy' }
  const oldEvidenceIds = new Set(first.evidence.map((item) => item.evidenceId))
  const fresh = await analyzeRepository(goal, fixture('complete-repo'), {}, undefined, first.evidence, staleCache)

  assert.equal(fresh.incrementalSummary?.mode, 'full')
  assert.deepEqual(fresh.incrementalSummary?.reused, [])
  assert.ok(fresh.actions.some((action) => action.action === 'read' && action.input === 'README.md'))
  assert.ok(fresh.evidence.every((item) => !oldEvidenceIds.has(item.evidenceId)))
})

test('sensitive evidence is not cached and interrupted or budgeted analysis stays partial', async () => {
  const sensitiveGoal = resolveStart(createGoalSpec({ intent: 'onboarding' }), 'direct')
  const sensitive = await analyzeRepository(sensitiveGoal, fixture('sensitive-repo'))
  assert.equal(sensitive.evidenceCache?.entries.some((entry) => entry.fingerprint.relativePath === '.env'), false)
  assert.equal(sensitive.evidenceCache?.entries.some((entry) => entry.fingerprint.relativePath === 'config.pem'), false)

  const controller = new AbortController()
  controller.abort()
  const interrupted = await analyzeRepository(sensitiveGoal, fixture('complete-repo'), {}, controller.signal)
  assert.equal(interrupted.interrupted, true)
  assert.ok(interrupted.incrementalSummary?.uncovered.length)

  const budgeted = await analyzeRepository(sensitiveGoal, fixture('complete-repo'), { maxTotalBytes: 1 })
  assert.equal(budgeted.scan.budget.exhausted, true)
  assert.ok(budgeted.incrementalSummary?.uncovered.includes('README.md'))
})

test('report export requires explicit confirmation', async () => {
  const goal = resolveStart(createGoalSpec(), 'direct')
  const session = await analyzeRepository(goal, fixture('complete-repo'))
  const report = generateReport(session)
  const config = createConfig(fixture('complete-repo'))
  const target = fixture('complete-repo', 'repo-atlas-output')
  try {
    const denied = await exportReportBundle(report, config, 'repo-atlas-output', false)
    assert.equal(denied.allowed, false)
    const allowed = await exportReportBundle(report, config, 'repo-atlas-output', true)
    assert.equal(allowed.allowed, true)
  } finally {
    await fs.rm(target, { recursive: true, force: true })
  }
})

test('report downgrades material conclusions that lack evidence', async () => {
  const goal = resolveStart(createGoalSpec(), 'direct')
  const session = await analyzeRepository(goal, fixture('complete-repo'))
  addConclusion(session.conclusions, '这条结论没有证据。', 'confirmed', [])
  const report = generateReport(session)
  assert.match(report.markdown, /报告降级为不确定/)
  assert.match(report.markdown, /\*\*未确认\*\* 这条结论没有证据/)
})
