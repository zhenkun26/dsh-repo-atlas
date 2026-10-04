import { createGoalSpec, missingGoalFields, nextClarificationQuestion, resolveStart } from '../clarification/goal.ts'
import { analyzeRepository } from '../repository/analyze.ts'
import { generateReport } from '../reporting/report.ts'
import { createEvidenceSearchTool, createImpactTool } from './intelligence-tools.ts'
import { createControlledActionTool } from './controlled-tool.ts'
import { createChangeProposalTool } from './change-proposal-tool.ts'
import { createChangeProposalVerificationRunner } from './change-proposal-verification.ts'
import { createChangeProposalCommitAuthorizer } from './change-proposal-commit.ts'
import { createChangeProposalLandingAuthorizer } from './change-proposal-landing.ts'
import { createHarnessRepositoryReader, type HarnessFileSystem } from './repository-reader.ts'
import { createSymbolTool } from './symbol-tool.ts'
import { HarnessSessionRuntimeRegistry, type HarnessSessionRuntimeResolution } from './session-runtime.ts'
import type { GoalSpec } from '../types.ts'
import type { HarnessPluginContext, HarnessTool, HarnessToolExecution, RepoAtlasPluginConfig, RepoAtlasToolResult } from './public.ts'

export const name = 'dsh-repo-atlas'
export const inject = ['tools'] as const

export function apply(ctx: HarnessPluginContext, pluginConfig: RepoAtlasPluginConfig = {}): void {
  if (pluginConfig.readerMode !== undefined && !['auto', 'local', 'harness'].includes(pluginConfig.readerMode)) throw new Error('readerMode must be auto, local or harness')
  const runtimes = new HarnessSessionRuntimeRegistry(pluginConfig)
  const resolveRuntime = runtimes.resolve.bind(runtimes)
  const commitAuthorizer = createChangeProposalCommitAuthorizer(ctx)
  const landingAuthorizer = createChangeProposalLandingAuthorizer(ctx)
  ctx.tools.register(createRepoAtlasTool(resolveRuntime, pluginConfig, ctx))
  ctx.tools.register(createEvidenceSearchTool(resolveRuntime))
  ctx.tools.register(createImpactTool(resolveRuntime))
  ctx.tools.register(createChangeProposalTool(
    resolveRuntime,
    runtime => createChangeProposalVerificationRunner(runtime.config, ctx),
    commitAuthorizer,
    landingAuthorizer,
  ))
  if (pluginConfig.controlledActions?.enabled === true) ctx.tools.register(createControlledActionTool(resolveRuntime, ctx))
  if (pluginConfig.symbols?.enabled === true) ctx.tools.register(createSymbolTool(resolveRuntime, ctx, pluginConfig))
  ctx.logger?.info('RepoAtlas registered read-only analysis tool')
  ctx.logger?.info('RepoAtlas registered session-only change proposal tool')
  if (pluginConfig.controlledActions?.enabled === true) ctx.logger?.info('RepoAtlas registered controlled action tool with explicit approval')
}

export function createRepoAtlasTool(resolveRuntime: (execution: HarnessToolExecution | undefined) => HarnessSessionRuntimeResolution, overrides: RepoAtlasPluginConfig = {}, ctx?: HarnessPluginContext): HarnessTool {
  return {
    name: 'repo_atlas_analyze',
    description: '通过多轮 GoalSpec 澄清后，对当前 workspace 执行受预算约束的只读代码库分析并生成证据化报告。',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'object', description: 'GoalSpec 或其部分字段' },
        start: { type: 'string', enum: ['clarify', 'confirm', 'direct'] },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [{
        type: 'text',
        text: JSON.stringify(value, null, 2),
      }],
    },
    async execute(input: unknown, execution: HarnessToolExecution): Promise<RepoAtlasToolResult> {
      const data = asInput(input)
      let goal = createGoalSpec(data.goal)
      if (data.start === 'direct') goal = resolveStart(goal, 'direct')
      if (!goal.confirmed) {
        return { policy: 'readonly', goal, clarification: { missing: missingGoalFields(goal), question: nextClarificationQuestion(goal) } }
      }
      const resolved = resolveRuntime(execution)
      if (!resolved.ok) return { policy: 'readonly', goal, blocked: { reason: resolved.reason } }
      let reader
      try {
        if (overrides.readerMode !== 'local') {
          const configured = ctx?.get?.<HarnessFileSystem>('fs', false)
          const provider = configured ? ctx?.get?.<HarnessFileSystem>('fs', true) : undefined
          if (configured && !provider) return { policy: 'readonly', goal, blocked: { reason: 'Configured Harness filesystem is inactive; no local fallback was attempted' } }
          if (provider) reader = await createHarnessRepositoryReader(provider, resolved.runtime.workspaceRoot, resolved.execution.signal)
          else if (overrides.readerMode === 'harness') return { policy: 'readonly', goal, blocked: { reason: 'Harness filesystem is unavailable' } }
        }
      } catch {
        return { policy: 'readonly', goal, blocked: { reason: 'Harness repository reader initialization failed; no local fallback was attempted' } }
      }
      const session = await analyzeRepository(goal, resolved.runtime.workspaceRoot, overrides, resolved.execution.signal, [], resolved.runtime.analysis?.evidenceCache, reader)
      if (resolved.execution.signal.aborted) return { policy: 'readonly', goal, blocked: { reason: 'analysis was cancelled' } }
      resolved.runtime.analysis = session
      resolved.runtime.proposalManager.registerSession(session)
      return { policy: 'readonly', goal, report: generateReport(session) }
    },
  }
}

function asInput(input: unknown): { goal: Partial<GoalSpec>; start?: 'clarify' | 'confirm' | 'direct' } {
  if (!input || typeof input !== 'object') return { goal: {} }
  const value = input as Record<string, unknown>
  const start = value.start === 'clarify' || value.start === 'confirm' || value.start === 'direct' ? value.start : undefined
  const goal = value.goal && typeof value.goal === 'object' ? value.goal as Partial<GoalSpec> : value as Partial<GoalSpec>
  return { goal, start }
}
