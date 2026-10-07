import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { buildDependencyGraph } from './dependency-graph.ts'
import { createAnalysisPlan } from './plan.ts'
import { RepositoryScanner } from './scanner.ts'
import type { RepositoryReader } from './reader.ts'
import { createConfig } from '../config.ts'
import { createEvidence, addConclusion } from '../evidence.ts'
import { isAstSupportedPath } from './ast-parser.ts'
import {
  createEvidenceCache,
  getCompatibleEvidenceCache,
  hasValidSourceMaterial,
  isPathCoveredByScope,
  replaceEvidenceForPaths,
  selectReusableEvidence,
} from './evidence-cache.ts'
import type {
  AnalysisSession,
  AstFileAnalysis,
  AstParseResult,
  Conclusion,
  Evidence,
  EvidenceCache,
  EvidenceCacheEntry,
  GoalSpec,
  IncrementalEvidenceSummary,
  RepoAtlasConfig,
  ReActActionRecord,
  ScannedFile,
  SourceSnapshot,
} from '../types.ts'

const CONFIG_PATHS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'README.md', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'jest.config.js']

export async function analyzeRepository(goal: GoalSpec, workspaceRoot: string, overrides: Partial<Omit<RepoAtlasConfig, 'workspaceRoot'>> = {}, signal?: AbortSignal, reusedEvidence: Evidence[] = [], previousCache?: EvidenceCache, reader?: RepositoryReader): Promise<AnalysisSession> {
  if (!goal.confirmed) throw new Error('GoalSpec must be confirmed before deep analysis')
  const scope = goal.scope?.length ? goal.scope : overrides.scope
  const config = createConfig(workspaceRoot, { ...overrides, scope })
  const scanner = new RepositoryScanner(config.workspaceRoot, config, reader)
  const plan = createAnalysisPlan(goal)
  const sessionId = `session-${randomUUID()}`
  let evidence: Evidence[] = []
  const actions: ReActActionRecord[] = []
  const conclusions: Conclusion[] = []
  let interrupted = false
  const astResults: AstFileAnalysis[] = []

  const scanBefore = await scanner.discover(signal)
  const discoveryStatus = scanBefore.budget.exhausted ? 'budget-exhausted' : signal?.aborted ? 'interrupted' : scanBefore.failures.length || scanBefore.ignorePolicy?.unsupportedRuleCount || scanBefore.ignorePolicy?.nestedPoliciesObserved ? 'unconfirmed' : 'confirmed'
  addAction(actions, 'list', '.', '列举 workspace 文件', scanBefore.files.length ? `发现 ${scanBefore.files.length} 个候选文件` : '未发现可分析文件', [], discoveryStatus)
  const compatibleCache = getCompatibleEvidenceCache(previousCache, config, scanner.reader.identity, scanBefore.ignorePolicy?.fingerprint)
  const incremental = compatibleCache !== undefined
  const selection = selectReusableEvidence(scanBefore.files, previousCache, config, {
    discoveryComplete: !scanBefore.budget.exhausted && !scanBefore.failures.length && !scanBefore.ignorePolicy?.unsupportedRuleCount && !scanBefore.ignorePolicy?.nestedPoliciesObserved && !signal?.aborted,
    readerIdentity: scanner.reader.identity,
    forceScopeReread: config.cacheValidation === 'content' ? true : undefined,
    requireSourceMaterial: true,
    ignoreFingerprint: scanBefore.ignorePolicy?.fingerprint,
  })
  evidence.push(createEvidence('workspace', '.', `发现 ${scanBefore.files.length} 个候选文件；跳过 ${scanBefore.skipped.length} 个路径`, discoveryStatus))
  evidence.push(...(incremental ? selection.evidence : previousCache ? [] : reusedEvidence))
  evidence = dedupeEvidence(evidence)

  const readableConfigPaths = scanBefore.files
    .filter((file) => !file.relativePath.includes('/') && CONFIG_PATHS.includes(file.relativePath))
    .map((file) => file.relativePath)
  const targetPaths = new Set([...readableConfigPaths, ...plan.steps.filter((step) => step.action === 'read').map((step) => step.target)].filter((target) => isPathCoveredByScope(target, config.scope)))
  const readTargets = incremental
    ? uniquePaths([...targetPaths, ...selection.rereadPaths].filter((target) => !selection.reusedPaths.includes(target)))
    : [...targetPaths]
  const textByPath = new Map<string, string>()
  for (const entry of compatibleCache?.entries ?? []) {
    if (selection.reusedPaths.includes(entry.fingerprint.relativePath) && hasValidSourceMaterial(entry)) textByPath.set(entry.fingerprint.relativePath, entry.sourceMaterial!.text)
  }
  const searchTextByPath = new Map(textByPath)
  const freshReadPaths: string[] = []
  const readResults: Array<{ path: string; status: string }> = []

  for (let index = 0; index < readTargets.length; index += 1) {
    const target = readTargets[index]
    if (signal?.aborted) {
      interrupted = true
      break
    }
    const result = await scanner.readText(target, signal)
    const status = result.status
    addAction(actions, 'read', target, `读取 ${target}`, result.reason ?? (result.text ? `读取 ${result.text.length} 个字符` : '无文本内容'), [], status)
    const item = createEvidence(target, '全文（已脱敏）', result.text ? result.text.slice(0, 8000) : result.reason ?? '未读取', status, result.redacted)
    evidence = replaceEvidenceForPaths(evidence, [item], [target])
    freshReadPaths.push(target)
    readResults.push({ path: target, status })
    if (result.text !== undefined) textByPath.set(target, result.text)
    searchTextByPath.set(target, result.text ?? '')
    if (scanner.snapshot().budget.exhausted) {
      if (status === 'interrupted') interrupted = true
      break
    }
  }

  const cachedConfigPaths = evidence
    .map((item) => item.sourcePath)
    .filter((item) => CONFIG_PATHS.includes(item) && textByPath.has(item))
  const parsedConfigPaths = uniquePaths([...readableConfigPaths, ...cachedConfigPaths])
  const parsedConfigs = await parseConfigs(scanner, parsedConfigPaths, signal, textByPath)
  const project = inferProject(config.workspaceRoot, scanBefore.files, parsedConfigs, evidence)
  addConclusion(conclusions, `项目可从 ${project.entries.length ? project.entries.join('、') : '未确认的入口线索'} 开始阅读。`, project.entries.length ? 'inferred' : 'unconfirmed', evidence.filter((item) => project.entries.includes(item.sourcePath)).map((item) => item.evidenceId))
  if (project.techStack.length) addConclusion(conclusions, `检测到技术栈线索：${project.techStack.join('、')}。`, 'inferred', evidence.filter((item) => CONFIG_PATHS.includes(item.sourcePath)).map((item) => item.evidenceId))

  const searchTerms = plan.steps.filter((step) => step.action === 'search')
  const searchPaths = scanBefore.files
    .filter((file) => /\.(?:[cm]?[jt]sx?|py|go|rs)$/.test(file.relativePath) && file.kind === 'text')
    .map((file) => file.relativePath)
    .slice(0, 40)
  const observedSearchText = new Map<string, string>()
  const searchReadPaths = new Set<string>()
  for (const step of searchTerms) {
    if (signal?.aborted) { interrupted = true; break }
    const matches = await scanner.search(step.target, searchPaths, signal, searchTextByPath, observedSearchText, searchReadPaths)
    for (const [sourcePath, text] of observedSearchText) searchTextByPath.set(sourcePath, text)
    const ids: string[] = []
    for (const match of matches.slice(0, 50)) {
      const item = createEvidence(match.path, `第 ${match.line} 行`, match.text, 'inferred')
      evidence.push(item)
      ids.push(item.evidenceId)
    }
    addAction(actions, 'search', step.target, step.purpose, `找到 ${matches.length} 条线索`, ids, matches.length ? 'inferred' : 'unconfirmed')
  }
  for (const [sourcePath, text] of observedSearchText) {
    textByPath.set(sourcePath, text)
    if (!evidence.some((item) => item.sourcePath === sourcePath && item.locator === '全文（已脱敏）')) {
      evidence.push(createEvidence(sourcePath, '全文（已脱敏）', text.slice(0, 8000), 'confirmed', true))
    }
  }
  freshReadPaths.push(...searchReadPaths)
  evidence = dedupeEvidence(evidence)

  const astPaths = scanBefore.files
    .filter((file) => file.kind === 'text' && isAstSupportedPath(file.relativePath) && isPathCoveredByScope(file.relativePath, config.scope))
    .map((file) => file.relativePath)
  const cachedAstPaths = new Set(evidence.filter((item) => item.evidenceKind === 'ast' && item.status === 'syntax-confirmed').map((item) => item.sourcePath))
  for (const sourcePath of astPaths) {
    if (cachedAstPaths.has(sourcePath)) {
      const count = evidence.filter((item) => item.sourcePath === sourcePath && item.evidenceKind === 'ast').length
      astResults.push({ relativePath: sourcePath, status: 'syntax-confirmed', parser: 'cache', observationCount: count })
      continue
    }
    if (astResults.length >= config.maxAstFiles) {
      astResults.push({ relativePath: sourcePath, status: 'budget-exhausted', parser: 'unavailable', observationCount: 0, reason: 'AST file budget exhausted; file was not analyzed' })
      continue
    }
    if (signal?.aborted) {
      interrupted = true
      astResults.push({ relativePath: sourcePath, status: 'interrupted', parser: 'unavailable', observationCount: 0, reason: 'user interrupted AST analysis' })
      continue
    }
    let sourceText = textByPath.get(sourcePath)
    if (sourceText === undefined) {
      const read = await scanner.readText(sourcePath, signal)
      addAction(actions, 'read', sourcePath, `读取 ${sourcePath} 供 AST 分析`, read.reason ?? (read.text ? `读取 ${read.text.length} 个字符` : '无文本内容'), [], read.status)
      readResults.push({ path: sourcePath, status: read.status })
      freshReadPaths.push(sourcePath)
      const item = createEvidence(sourcePath, '全文（已脱敏）', read.text ? read.text.slice(0, 8000) : read.reason ?? '未读取', read.status, read.redacted)
      evidence = replaceEvidenceForPaths(evidence, [item], [sourcePath])
      if (read.text !== undefined) {
        sourceText = read.text
        textByPath.set(sourcePath, read.text)
      }
    }
    if (sourceText === undefined) {
      const failed = { relativePath: sourcePath, status: readResults.find((item) => item.path === sourcePath)?.status as AstFileAnalysis['status'] ?? 'read-failed', parser: 'unavailable' as const, observationCount: 0, reason: 'safe read did not produce text' }
      astResults.push(failed)
      continue
    }
    const parsed = await scanner.parseAst(sourcePath, signal, sourceText)
    const astEvidence: Evidence[] = parsed.observations.map((observation) => createEvidence(
      sourcePath,
      `第 ${observation.line} 行第 ${observation.column} 列`,
      observation.summary,
      'syntax-confirmed',
      true,
      { evidenceKind: 'ast', astObservation: observation, astParser: parsed.parser },
    ))
    const failureEvidence = parsed.reason && parsed.status !== 'syntax-confirmed'
      ? [createEvidence(sourcePath, 'AST', parsed.reason, parsed.status, false, { evidenceKind: 'ast' })]
      : []
    evidence.push(...astEvidence, ...failureEvidence)
    const astEvidenceIds = [...astEvidence, ...failureEvidence].map((item) => item.evidenceId)
    addAction(actions, 'parse-ast', sourcePath, `解析 ${sourcePath} 的受限语法结构`, parsed.reason ?? `生成 ${parsed.observationCount} 条语法观察`, astEvidenceIds, parsed.status)
    astResults.push({ relativePath: parsed.relativePath, status: parsed.status, parser: parsed.parser, observationCount: parsed.observationCount, reason: parsed.reason })
    if (parsed.status === 'interrupted') interrupted = true
  }
  for (const sourcePath of scanBefore.files
    .filter((file) => file.kind === 'text' && !isAstSupportedPath(file.relativePath) && isPathCoveredByScope(file.relativePath, config.scope))
    .map((file) => file.relativePath)
    .slice(0, 100)) {
    astResults.push({ relativePath: sourcePath, status: 'not-analyzed', parser: 'unavailable', observationCount: 0, reason: 'v1.3 AST analysis supports only .ts, .tsx, .js, and .jsx files' })
  }
  evidence = dedupeEvidence(evidence)

  const { edges } = buildDependencyGraph(scanBefore.files, evidence)
  if (plan.name === 'architecture') {
    const syntaxEdges = edges.filter((edge) => edge.status === 'syntax-confirmed')
    const inferredEdges = edges.filter((edge) => edge.status === 'inferred')
    if (syntaxEdges.length) addConclusion(conclusions, `已由受限语法结构确认 ${syntaxEdges.length} 条模块关系；未执行代码，也未进行类型或运行时证明。`, 'syntax-confirmed', syntaxEdges.flatMap((edge) => edge.evidenceIds))
    if (inferredEdges.length) addConclusion(conclusions, `另有 ${inferredEdges.length} 条模块关系仅由静态文本推断；未执行代码，因此仍需人工确认。`, 'inferred', inferredEdges.flatMap((edge) => edge.evidenceIds))
  }

  const scan = scanner.snapshot()
  if (scan.budget.exhausted) addConclusion(conclusions, '分析触及资源预算，以上结果是部分结果。', 'budget-exhausted', [evidence[0]?.evidenceId].filter(Boolean) as string[])
  if (interrupted) addConclusion(conclusions, '用户中断了分析，以上结果保留已完成部分。', 'interrupted', [])
  const summary = createIncrementalSummary(incremental, selection, freshReadPaths, readResults, readTargets.filter(target => !freshReadPaths.includes(target)))
  const sourceSnapshots = createSourceSnapshots(textByPath, evidence, freshReadPaths, selection.uncoveredPaths, config.maxTotalBytes)
  const evidenceCache = buildEvidenceCache(config, scan.files, evidence, compatibleCache, selection, freshReadPaths, scanner.reader.identity, sourceSnapshots, scan.ignorePolicy?.fingerprint ?? '')
  return { sessionId, workspaceRoot: config.workspaceRoot, goal, plan, scan, evidence, conclusions, actions, edges, project, interrupted, ast: astResults, evidenceCache, incrementalSummary: summary,
    reader: { identity: scanner.reader.identity, kind: scanner.reader.kind, hostBacked: scanner.reader.hostBacked }, sourceSnapshots }
}

async function parseConfigs(scanner: RepositoryScanner, paths: string[], signal?: AbortSignal, providedText?: ReadonlyMap<string, string>): Promise<Array<{ path: string; values: Record<string, unknown> }>> {
  const results = []
  for (const file of paths.filter((item) => item !== 'README.md')) {
    if (signal?.aborted) break
    const result = providedText?.has(file)
      ? await scanner.parseConfig(file, signal, providedText.get(file))
      : await scanner.parseConfig(file, signal)
    if (Object.keys(result.values).length) results.push({ path: result.path, values: result.values })
  }
  return results
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)]
}

function dedupeEvidence(evidence: readonly Evidence[]): Evidence[] {
  return [...new Map(evidence.map((item) => [item.evidenceId, item])).values()]
}

function createSourceSnapshots(textByPath: ReadonlyMap<string, string>, evidence: readonly Evidence[], freshReadPaths: readonly string[], uncoveredPaths: readonly string[], maxBytes: number): Map<string, SourceSnapshot> {
  const result = new Map<string, SourceSnapshot>()
  let retainedBytes = 0
  for (const [sourcePath, text] of textByPath) {
    const item = evidence.find(item => item.sourcePath === sourcePath && item.locator === '全文（已脱敏）' && item.status === 'confirmed')
    const bytes = Buffer.byteLength(text)
    if (!item || retainedBytes + bytes > maxBytes) continue
    retainedBytes += bytes
    result.set(sourcePath, { text, evidenceId: item.evidenceId, redactedContentSha256: createHash('sha256').update(text).digest('hex'),
      validation: uncoveredPaths.includes(sourcePath) ? 'not-revalidated' : freshReadPaths.includes(sourcePath) ? 'read-and-version-checked' : 'metadata-reused' })
  }
  return result
}

function createIncrementalSummary(
  incremental: boolean,
  selection: ReturnType<typeof selectReusableEvidence>,
  freshReadPaths: readonly string[],
  readResults: ReadonlyArray<{ path: string; status: string }>,
  notReadPaths: readonly string[],
): IncrementalEvidenceSummary {
  const failedReads = readResults.filter((result) => result.status !== 'confirmed').map((result) => result.path)
  return {
    mode: incremental ? 'incremental' : 'full',
    reused: boundedPaths(incremental ? selection.reusedPaths : []),
    invalidated: boundedPaths(incremental ? uniquePaths([...selection.invalidatedPaths, ...selection.removedPaths]) : []),
    reread: boundedPaths(freshReadPaths),
    new: boundedPaths(incremental ? selection.newPaths : freshReadPaths),
    uncovered: boundedPaths(uniquePaths([...selection.uncoveredPaths, ...failedReads, ...notReadPaths])),
  }
}

function boundedPaths(paths: readonly string[]): string[] {
  return uniquePaths(paths).slice(0, 100)
}

function buildEvidenceCache(
  config: RepoAtlasConfig,
  files: readonly ScannedFile[],
  evidence: readonly Evidence[],
  compatibleCache: EvidenceCache | undefined,
  selection: ReturnType<typeof selectReusableEvidence>,
  freshReadPaths: readonly string[],
  readerIdentity: string,
  sourceSnapshots: ReadonlyMap<string, SourceSnapshot>,
  ignoreFingerprint: string,
): EvidenceCache {
  const entries = new Map<string, EvidenceCacheEntry>(compatibleCache?.entries.map(entry => [entry.fingerprint.relativePath, structuredClone(entry)]) ?? [])
  const replacedPaths = new Set([...selection.invalidatedPaths, ...selection.removedPaths, ...selection.rereadPaths, ...selection.newPaths, ...freshReadPaths])
  for (const relativePath of replacedPaths) entries.delete(relativePath)
  const coverage = [...(config.scope?.length ? config.scope : ['.'])]
  for (const file of files) {
    if (file.kind !== 'text' || !file.fingerprint) continue
    const fileEvidence = evidence.filter((item) => item.sourcePath === file.relativePath && isCacheableEvidence(item))
    if (!fileEvidence.length) continue
    entries.set(file.relativePath, {
      fingerprint: { ...file.fingerprint },
      coverage,
      evidence: fileEvidence.map((item) => ({ ...item })),
      sourceMaterial: sourceSnapshots.has(file.relativePath) ? { ...sourceSnapshots.get(file.relativePath)! } : undefined,
    })
  }
  const boundedEntries = [...entries.values()].slice(0, config.maxCandidateFiles)
  let retainedBytes = 0
  for (const entry of boundedEntries) {
    if (!entry.sourceMaterial) continue
    const bytes = Buffer.byteLength(entry.sourceMaterial.text)
    if (retainedBytes + bytes > config.maxTotalBytes) entry.sourceMaterial = undefined
    else retainedBytes += bytes
  }
  return createEvidenceCache(config, boundedEntries, readerIdentity, ignoreFingerprint)
}

function isCacheableEvidence(item: Evidence): boolean {
  return ['confirmed', 'syntax-confirmed', 'inferred', 'unconfirmed', 'not-analyzed'].includes(item.status)
}

function inferProject(workspaceRoot: string, files: AnalysisSession['scan']['files'], configs: Array<{ path: string; values: Record<string, unknown> }>, evidence: Evidence[]): AnalysisSession['project'] {
  const paths = uniquePaths([
    ...files.map((file) => file.relativePath),
    ...evidence.map((item) => item.sourcePath).filter(isRepositoryRelativePath),
  ])
  const dirs = [...new Set(paths.filter((item) => item.includes('/')).map((item) => item.split('/')[0]))].slice(0, 20)
  const techStack: string[] = []
  if (configs.some((item) => item.path === 'package.json') || paths.includes('package.json')) techStack.push('Node.js / JavaScript')
  if (configs.some((item) => item.path.endsWith('.ts') || item.path === 'tsconfig.json') || paths.includes('tsconfig.json')) techStack.push('TypeScript')
  if (configs.some((item) => item.path === 'pyproject.toml') || paths.includes('pyproject.toml')) techStack.push('Python')
  if (configs.some((item) => item.path === 'go.mod') || paths.includes('go.mod')) techStack.push('Go')
  if (configs.some((item) => item.path === 'Cargo.toml') || paths.includes('Cargo.toml')) techStack.push('Rust')
  const entries = evidence.filter((item) => /(^|\/)(main|index|app|server|cli)(\.[^.]+)?$/.test(item.sourcePath)).map((item) => item.sourcePath).slice(0, 10)
  const runtimeConfig = paths.filter((item) => /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|tsconfig\.json|vite\.config\.|next\.config\.)/.test(item)).slice(0, 20)
  const testConfig = paths.filter((item) => /(jest|vitest|pytest|test|spec|coverage)/i.test(item)).slice(0, 20)
  const readingOrder = [...new Set(['README.md', ...runtimeConfig, ...entries, ...dirs.map((dir) => `${dir}/`)].filter((item) => item === 'README.md' || paths.includes(item) || item.endsWith('/')))].slice(0, 20)
  return {
    name: String(configs.find((item) => item.path === 'package.json')?.values.name ?? path.basename(workspaceRoot)),
    summary: '基于仓库静态文件和配置的只读分析摘要。',
    techStack,
    entries,
    coreDirectories: dirs,
    runtimeConfig,
    testConfig,
    readingOrder,
  }
}

function isRepositoryRelativePath(value: string): boolean {
  return value !== 'workspace' && !value.startsWith('/') && value !== '.' && !value.split('/').includes('..')
}

function addAction(actions: ReActActionRecord[], action: ReActActionRecord['action'], input: string, thought: string, observation: string, evidenceIds: string[], status: ReActActionRecord['status']): void {
  actions.push({ actionId: `action-${randomUUID()}`, thought, action, input, observation, status, evidenceIds })
}
