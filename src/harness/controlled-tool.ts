import { withJsonOutput } from './json-output.ts'
import { decideControlledAction } from '../actions/controlled.ts'
import { runControlledAction, type ControlledActionResult, type ControlledActionRuntime, type ControlledActionSubprocess, type ControlledActionSandbox, type ControlledActionPolicy, type ControlledActionPolicyResolver } from '../actions/runtime.ts'
import type { RepoAtlasConfig } from '../types.ts'
import type { HarnessAgent, HarnessApprovalService, HarnessGoalService, HarnessPluginContext, HarnessSandboxPolicyService, HarnessTool, HarnessToolExecution } from './public.ts'
import type { HarnessSessionRuntimeResolution } from './session-runtime.ts'

export function createControlledActionTool(
  resolveRuntime: (execution: HarnessToolExecution | undefined) => HarnessSessionRuntimeResolution,
  ctx: HarnessPluginContext,
): HarnessTool {
  return withJsonOutput({
    name: 'repo_atlas_controlled_action',
    description: '在已确认 Goal 和一次性用户授权后，运行配置中的受控项目检查 recipe；不接受自由 Shell 命令。',
    parameters: {
      type: 'object',
      properties: {
        recipeId: { type: 'string', description: '已配置的 recipe 标识' },
        cwd: { type: 'string', description: 'workspace 内的相对工作目录' },
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
    async execute(input: unknown, execution: HarnessToolExecution) {
      const request = actionInput(input)
      const resolved = resolveRuntime(execution)
      if (!resolved.ok) return deniedRuntimeResult(request.recipeId, resolved.reason)
      if (resolved.runtime.analysis?.reader?.hostBacked === false) return deniedRuntimeResult(request.recipeId, 'provider evidence has no verified host mapping for controlled local checks')
      const exec = resolved.execution
      const config = resolved.runtime.config
      const goalConfirmed = hasConfirmedGoal(ctx.get?.<HarnessGoalService>('goals'), exec.agent)
      const preflight = decideControlledAction(config, {
        ...request,
        workspaceRoot: resolved.runtime.workspaceRoot,
        session: exec.agent?.session,
        goalConfirmed,
        userConfirmed: true,
        signal: exec.signal,
      })
      if (!preflight.allowed) return deniedResult(preflight)
      const approval = await requestApproval(
        ctx.get?.<HarnessApprovalService>('approval'),
        exec,
        request.recipeId,
        request.cwd,
        config,
        goalConfirmed,
      )
      const result = await runControlledAction(config, {
        ...request,
        workspaceRoot: resolved.runtime.workspaceRoot,
        session: exec.agent?.session,
        goalConfirmed,
        userConfirmed: approval.allowed,
        confirmationReason: approval.reason,
        signal: exec.signal,
      }, createControlledActionRuntime(ctx, exec))
      return result
    },
  })
}

function deniedRuntimeResult(recipeId: string, reason: string): ControlledActionResult {
  return {
    status: 'denied',
    auditId: `action-${crypto.randomUUID()}`,
    recipeId,
    reason,
    stdout: '',
    stderr: '',
    outputTruncated: false,
    redacted: false,
    redactedMatchCount: 0,
  }
}

function deniedResult(decision: { auditId: string; recipeId: string; reason: string; cwd?: string }): ControlledActionResult {
  return {
    status: 'denied',
    auditId: decision.auditId,
    recipeId: decision.recipeId,
    reason: decision.reason,
    cwd: decision.cwd,
    stdout: '',
    stderr: '',
    outputTruncated: false,
    redacted: false,
    redactedMatchCount: 0,
  }
}

function actionInput(input: unknown): { recipeId: string; cwd?: string } {
  if (!isRecord(input)) return { recipeId: '' }
  return {
    recipeId: typeof input.recipeId === 'string' ? input.recipeId : '',
    cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
  }
}

function hasConfirmedGoal(goals: HarnessGoalService | undefined, agent: HarnessAgent | undefined): boolean {
  if (!goals || !agent) return false
  try {
    const goal = goals.get(agent)
    return goal?.phase === 'active' && goal.activation === 'armed'
  } catch {
    return false
  }
}

async function requestApproval(
  approval: HarnessApprovalService | undefined,
  execution: HarnessToolExecution,
  recipeId: string,
  cwd: string | undefined,
  config: RepoAtlasConfig,
  goalConfirmed: boolean,
): Promise<{ allowed: boolean; reason: string }> {
  if (!goalConfirmed) return { allowed: false, reason: 'host-attested active and armed Goal is required before an action' }
  if (!approval) return { allowed: false, reason: 'Harness approval capability is unavailable' }
  if (!execution.agent || !execution.callId) return { allowed: false, reason: 'a live Harness agent and tool call id are required for approval' }
  const recipe = config.controlledActions.recipes.find((candidate) => candidate.id === recipeId)
  const mode = recipe?.sandboxMode ?? 'read-only'
  const reason = `Approve one RepoAtlas recipe invocation: ${recipeId} at ${cwd ?? '.'} under ${mode}`
  try {
    const outcome = await approval.request({
      agent: execution.agent,
      toolName: 'repo_atlas_controlled_action',
      callId: execution.callId,
      reason,
      signal: execution.signal,
    })
    return outcome === 'allowed-once'
      ? { allowed: true, reason: 'Harness approval granted for one invocation' }
      : { allowed: false, reason: `Harness approval outcome: ${outcome}` }
  } catch {
    return { allowed: false, reason: 'Harness approval request failed closed' }
  }
}

function createControlledActionRuntime(ctx: HarnessPluginContext, execution: HarnessToolExecution): ControlledActionRuntime {
  const sandboxPolicy = ctx.get?.<HarnessSandboxPolicyService>('sandboxPolicy')
  const policy: ControlledActionPolicyResolver | undefined = sandboxPolicy === undefined ? undefined : {
    resolve(request) {
      const resolved = sandboxPolicy.resolve({ mode: request.mode, session: execution.agent?.session })
      if (resolved.mode !== 'read-only' && resolved.mode !== 'workspace-write') {
        throw new Error('unsupported sandbox mode returned by Harness')
      }
      return {
        mode: resolved.mode,
        workspaceRoot: resolved.workspaceRoot,
        sessionId: resolved.sessionId,
      }
    },
  }
  return {
    subprocess: ctx.get?.<ControlledActionSubprocess>('subprocess'),
    sandbox: ctx.get?.<ControlledActionSandbox>('sandbox'),
    sandboxPolicy: policy,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
