import type { AnalysisReport, GoalSpec, RepoAtlasConfig } from '../types.ts'

export interface HarnessSession {
  header?: { id?: string; cwd?: string }
}

export interface HarnessAgent {
  session: HarnessSession
}

export interface HarnessToolExecution {
  callId?: string
  agent?: HarnessAgent
  signal: AbortSignal
}

/**
 * Minimal structural surface used by the public DeepSeek Harness plugin API.
 * The adapter intentionally avoids private Harness internals.
 */
export interface HarnessTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Harness requires a lossless canonical output declaration for every tool. */
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(input: unknown, execution: HarnessToolExecution): Promise<unknown>
}

export interface HarnessPluginContext {
  tools: { register(tool: HarnessTool): unknown }
  logger?: { info(message: string): void; warn(message: string): void }
  get?<T>(name: string, strict?: boolean): T | undefined
}

export type HarnessApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface HarnessApprovalService {
  request(request: {
    agent: HarnessAgent
    toolName: string
    callId?: string
    reason?: string
    signal?: AbortSignal
  }): Promise<HarnessApprovalOutcome>
}

export interface HarnessGoalService {
  get(agent: HarnessAgent): { phase: 'active' | 'paused' | 'blocked' | 'complete'; activation: 'armed' | 'disarmed' } | undefined
}

export type HarnessSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export interface HarnessSandboxPolicyService {
  resolve(request?: { mode?: HarnessSandboxMode; session?: HarnessSession }): {
    mode: string
    workspaceRoot: string
    sessionId?: string
  }
}

export interface RepoAtlasPluginConfig extends Partial<Omit<RepoAtlasConfig, 'workspaceRoot'>> {
  workspaceRoot?: string
  readerMode?: 'auto' | 'local' | 'harness'
  symbols?: { enabled?: boolean; timeoutMs?: number; maxResults?: number }
}

export interface RepoAtlasToolResult {
  blocked?: { reason: string }
  clarification?: unknown
  report?: AnalysisReport
  policy: 'readonly'
  goal: GoalSpec
}
