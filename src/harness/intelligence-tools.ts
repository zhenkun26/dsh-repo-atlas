import { analyzeImpact, searchEvidence } from '../repository/intelligence.ts'
import type { AnalysisSession } from '../types.ts'
import type { HarnessTool, HarnessToolExecution } from './public.ts'
import type { HarnessSessionRuntimeResolution } from './session-runtime.ts'

type ResolveRuntime = (execution: HarnessToolExecution | undefined) => HarnessSessionRuntimeResolution

export function createEvidenceSearchTool(resolve: ResolveRuntime): HarnessTool {
  return createTool(resolve, 'repo_atlas_search',
    'Search retained, redacted evidence from the latest repo_atlas_analyze in this exact session. Results are snapshots, not live file verification.',
    { query: { type: 'string', minLength: 1, maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
    ['query'], (session, input) => searchEvidence(session, input.query as string, input.limit as number | undefined))
}

export function createImpactTool(resolve: ResolveRuntime): HarnessTool {
  return createTool(resolve, 'repo_atlas_impact',
    'Trace possible impact through reverse static imports in the latest analysis snapshot. Returns evidence chains and unknown coverage; never predicts definite runtime breakage.',
    { targets: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
      maxDepth: { type: 'integer', minimum: 1, maximum: 10 }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    ['targets'], (session, input) => analyzeImpact(session, input.targets as string[], input.maxDepth as number | undefined, input.limit as number | undefined))
}

function createTool(resolve: ResolveRuntime, name: string, description: string, properties: Record<string, unknown>, required: string[],
  query: (session: AnalysisSession, input: Record<string, unknown>) => unknown): HarnessTool {
  return {
    name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(input, execution) {
      const resolved = resolve(execution)
      if (!resolved.ok) return { policy: 'readonly', blocked: { reason: resolved.reason } }
      if (!resolved.runtime.analysis) return { policy: 'readonly', blocked: { reason: 'Run repo_atlas_analyze in this session first.' } }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { policy: 'readonly', blocked: { reason: 'Expected an object.' } }
      const data = input as Record<string, unknown>
      if (Object.keys(data).some(key => !Object.hasOwn(properties, key))) return { policy: 'readonly', blocked: { reason: 'Unknown query parameter.' } }
      try {
        return { policy: 'readonly', result: query(resolved.runtime.analysis, data) }
      } catch (error) {
        return { policy: 'readonly', blocked: { reason: error instanceof Error ? error.message : 'Invalid query.' } }
      }
    },
  }
}
