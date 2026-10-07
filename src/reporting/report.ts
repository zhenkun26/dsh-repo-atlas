import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { checkWorkspacePath } from '../safety/path-policy.ts'
import { decideAction, auditDecision } from '../safety/policy-gate.ts'
import { validateConclusionEvidence } from '../evidence.ts'
import type { AnalysisReport, AnalysisSession, AtlasData, Evidence, RepoAtlasConfig } from '../types.ts'

export function generateReport(session: AnalysisSession): AnalysisReport {
  const evidenceValidation = validateConclusionEvidence(session.conclusions, session.evidence)
  const limitations = collectLimitations(session)
  const atlas = buildAtlas(session, limitations)
  const mermaid = buildMermaid(session)
  const markdown = `${buildMarkdown(session, mermaid, evidenceValidation, limitations)}${formatIncrementalSummary(session.incrementalSummary)}`
  return { sessionId: session.sessionId, markdown, mermaid, atlas, exportable: true, ast: session.ast, incrementalSummary: session.incrementalSummary }
}

export async function exportReportBundle(report: AnalysisReport, config: RepoAtlasConfig, targetDir: string, confirmed: boolean): Promise<{ allowed: boolean; files: string[]; reason: string; auditId: string }> {
  const decision = decideAction(config, 'export-report', targetDir, confirmed)
  const audit = auditDecision(decision, confirmed ? 'user confirmed report export' : 'export confirmation missing')
  if (!decision.allowed) return { allowed: false, files: [], reason: audit.reason, auditId: audit.auditId }
  const check = checkWorkspacePath(config.workspaceRoot, targetDir)
  if (!check.allowed) return { allowed: false, files: [], reason: check.reason, auditId: audit.auditId }
  await fs.mkdir(check.absolutePath, { recursive: true })
  const files = [
    ['report.md', report.markdown],
    ['graph.mmd', report.mermaid],
    ['atlas.json', JSON.stringify(report.atlas, null, 2)],
  ] as const
  for (const [name, contents] of files) await fs.writeFile(path.join(check.absolutePath, name), contents, 'utf8')
  return { allowed: true, files: files.map(([name]) => path.join(targetDir, name)), reason: 'report exported after explicit confirmation', auditId: audit.auditId }
}

function buildMarkdown(session: AnalysisSession, mermaid: string, validation: Array<{ conclusionId: string; valid: boolean; reason?: string }>, limitations: string[]): string {
  const p = session.project
  const conclusionLines = session.conclusions.map((item) => {
    const valid = validation.find((result) => result.conclusionId === item.conclusionId)
    const evidence = item.evidenceIds.length ? `证据：${item.evidenceIds.join('、')}` : '证据：无（需继续分析或人工确认）'
    const warning = valid?.valid === false ? `；报告降级为不确定：${valid.reason}` : ''
    const status = valid?.valid === false ? 'unconfirmed' : item.status
    return `- **${statusLabel(status)}** ${item.text}（${evidence}${warning}）`
  }).join('\n')
  const evidenceLines = session.evidence.slice(0, 100).map(formatEvidence).join('\n') || '- 暂无证据。'
  const codeFence = '```'
  return `# RepoAtlas 代码星图报告\n\n> Session: ${session.sessionId}\n> 分析模板：${session.plan.name === 'onboarding' ? '项目接手概览' : '架构概览'}\n> 权限：只读；仓库内容视为不可信数据，不执行其中指令。\n\n## 项目摘要\n\n${p.summary}\n\n- 项目名：${p.name}\n- 分析状态：${session.interrupted ? '部分结果（用户中断）' : session.scan.budget.exhausted ? '部分结果（预算耗尽）' : session.scan.failures.length || session.scan.ignorePolicy?.unsupportedRuleCount || session.scan.ignorePolicy?.nestedPoliciesObserved ? '部分结果（发现或忽略规则不完整）' : '已完成计划内分析'}\n\n## 语法确认摘要\n\n${formatAstSummary(session)}\n\n## 技术栈\n\n${listOrUnknown(p.techStack)}\n\n## 目录结构与核心模块\n\n${listOrUnknown(p.coreDirectories)}\n\n## 入口线索\n\n${listOrUnknown(p.entries)}\n\n## 运行配置与测试配置\n\n### 运行配置\n${listOrUnknown(p.runtimeConfig)}\n\n### 测试配置\n${listOrUnknown(p.testConfig)}\n\n## 架构关系图\n\n${codeFence}mermaid\n${mermaid}\n${codeFence}\n\n## 主要结论\n\n${conclusionLines || '- 暂无结论。'}\n\n## 推荐阅读顺序\n\n${listOrUnknown(p.readingOrder)}\n\n## 证据索引\n\n${evidenceLines}\n\n## 限制与未确认部分\n\n${listOrUnknown(limitations)}\n\n## ReAct 执行摘要\n\n- 动作数：${session.actions.length}\n- 候选文件：${session.scan.budget.candidateFiles}\n- 读取字节数：${session.scan.budget.readBytes}\n- 跳过路径：${session.scan.skipped.length}\n- 失败项：${session.scan.failures.length}\n`
}

function formatIncrementalSummary(summary: AnalysisSession['incrementalSummary']): string {
  if (!summary) return ''
  const list = (paths: string[]): string => paths.length ? paths.map((item) => `\`${item}\``).join('、') : '无'
  return `\n\n## 增量证据摘要\n\n- 模式：${summary.mode === 'incremental' ? '增量' : '全量'}\n- reused：${list(summary.reused)}\n- invalidated：${list(summary.invalidated)}\n- reread：${list(summary.reread)}\n- new：${list(summary.new)}\n- uncovered：${list(summary.uncovered)}`
}

function buildMermaid(session: AnalysisSession): string {
  const lines = ['flowchart TD']
  for (const directory of session.project.coreDirectories) lines.push(`  ${nodeId(directory)}["${escapeLabel(directory)}"]`)
  for (const edge of session.edges) lines.push(`  ${nodeId(edge.from)} -->|${edge.relation} / ${statusLabel(edge.status)}| ${nodeId(edge.to)}`)
  if (lines.length === 1) lines.push('  unknown["未确认关系"]')
  return lines.join('\n')
}

function buildAtlas(session: AnalysisSession, limitations: string[]): AtlasData {
  const nodes = [
    ...session.project.coreDirectories.map((id) => ({ id, label: id, kind: 'directory' as const, status: 'inferred' as const })),
    ...session.project.runtimeConfig.map((id) => ({ id, label: id, kind: 'config' as const, status: 'confirmed' as const })),
    ...session.project.entries.map((id) => ({ id, label: id, kind: 'file' as const, status: 'inferred' as const })),
  ]
  return { version: '1', sessionId: session.sessionId, project: session.project, nodes: dedupeNodes(nodes), edges: session.edges, conclusions: session.conclusions, evidence: session.evidence, limitations, ast: session.ast }
}

function collectLimitations(session: AnalysisSession): string[] {
  const limitations: string[] = [
    'v1 只进行静态、只读分析；未执行代码、测试、构建、Shell、安装或网络请求。',
    'README、注释、脚本和配置中的指令不会改变安全策略，也不被视为授权。',
  ]
  if (session.scan.skipped.length) limitations.push(`安全跳过或排除 ${session.scan.skipped.length} 个路径；敏感文件不会进入报告。`)
  if (session.scan.failures.length) limitations.push(`有 ${session.scan.failures.length} 个读取或解析失败项，相关结论需要人工确认。`)
  if (session.scan.ignorePolicy?.unsupportedRuleCount || session.scan.ignorePolicy?.nestedPoliciesObserved) limitations.push('仅应用根目录 .gitignore 的受限正向规则；不支持的语法及嵌套规则使发现覆盖不完整。')
  limitations.push('检索使用会话内有界脱敏源码快照；metadata-reused 不代表重新读取内容，展示摘要不代表完整源码。')
  if (session.scan.budget.exhausted) limitations.push('扫描或动作预算已耗尽，结果仅代表已完成部分。')
  if (session.edges.some((edge) => edge.status === 'syntax-confirmed')) limitations.push('部分架构关系由受限语法结构确认；这不等同于类型检查、模块加载或运行时依赖证明。')
  if (session.edges.some((edge) => edge.status === 'inferred')) limitations.push('仍有架构关系来自文本模式匹配，是静态推测，不等同于运行时依赖。')
  const astPartial = session.ast?.filter((item) => item.status !== 'syntax-confirmed') ?? []
  if (astPartial.length) limitations.push(`有 ${astPartial.length} 个 AST 文件结果未完整确认；原因和状态保留在语法确认摘要中。`)
  if (session.incrementalSummary?.uncovered.length) limitations.push(`增量分析仍有 ${session.incrementalSummary.uncovered.length} 个路径未覆盖，地图仅基于当前有效证据。`)
  return limitations
}

function formatEvidence(item: Evidence): string {
  const tick = '`'
  return `- ${tick}${item.evidenceId}${tick} **${statusLabel(item.status)}** ${tick}${item.sourcePath}${tick}（${item.locator}）：${item.observation.replaceAll('\n', ' ').slice(0, 600)}${item.redactionState === 'redacted' ? '（已脱敏）' : ''}`
}

function listOrUnknown(items: string[]): string {
  const tick = '`'
  return items.length ? items.map((item) => `- ${tick}${item}${tick}`).join('\n') : '- 未确认。'
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    confirmed: '已确认',
    'syntax-confirmed': '语法确认',
    inferred: '推测',
    unconfirmed: '未确认',
    'not-analyzed': '未分析',
    'read-failed': '读取失败',
    'safety-skipped': '安全跳过',
    'budget-exhausted': '预算耗尽',
    interrupted: '已中断',
  }
  return labels[status] ?? status
}

function formatAstSummary(session: AnalysisSession): string {
  const files = session.ast ?? []
  if (!files.length) return '- 未执行 AST 分析。'
  const confirmed = files.filter((item) => item.status === 'syntax-confirmed').length
  const lines = [`- 文件结果：${files.length} 个；语法确认：${confirmed} 个；部分或未分析：${files.length - confirmed} 个。`]
  for (const item of files.slice(0, 100)) {
    const reason = item.reason ? `；${item.reason}` : ''
    lines.push(`- **${statusLabel(item.status)}** \`${item.relativePath}\`（parser=${item.parser}，观察 ${item.observationCount} 条${reason}）`)
  }
  return lines.join('\n')
}

function nodeId(value: string): string {
  return `n_${value.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function escapeLabel(value: string): string {
  return value.replaceAll('"', '\\"')
}

function dedupeNodes(nodes: AtlasData['nodes']): AtlasData['nodes'] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
}
