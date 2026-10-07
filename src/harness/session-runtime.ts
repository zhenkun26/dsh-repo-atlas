import path from 'node:path'
import { createConfig } from '../config.ts'
import { ChangeProposalManager } from '../repository/change-proposal.ts'
import type { AnalysisSession, RepoAtlasConfig } from '../types.ts'
import type { HarnessSession, HarnessToolExecution, RepoAtlasPluginConfig } from './public.ts'

export interface HarnessSessionRuntime {
  session: HarnessSession
  workspaceRoot: string
  config: RepoAtlasConfig
  proposalManager: ChangeProposalManager
  analysis?: AnalysisSession
}

export type HarnessSessionRuntimeResolution =
  | { ok: true; execution: HarnessToolExecution; runtime: HarnessSessionRuntime }
  | { ok: false; reason: string }

export class HarnessSessionRuntimeRegistry {
  private readonly runtimes = new WeakMap<HarnessSession, HarnessSessionRuntime>()
  private readonly configuredRoot?: string
  private readonly pluginConfig: RepoAtlasPluginConfig

  constructor(pluginConfig: RepoAtlasPluginConfig = {}) {
    this.pluginConfig = pluginConfig
    this.configuredRoot = pluginConfig.workspaceRoot === undefined
      ? undefined
      : path.resolve(pluginConfig.workspaceRoot)
  }

  resolve(execution: HarnessToolExecution | undefined): HarnessSessionRuntimeResolution {
    if (!execution) return unavailable('a live Harness tool execution is required')
    if (!execution.signal || typeof execution.signal.aborted !== 'boolean') {
      return unavailable('a live Harness cancellation signal is required')
    }
    if (execution.signal.aborted) return unavailable('the Harness invocation was cancelled before RepoAtlas started')

    const session = execution.agent?.session
    if (!session) return unavailable('a live Harness agent session is required')
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || !cwd.trim() || !path.isAbsolute(cwd)) {
      return unavailable('the Harness session must provide an absolute workspace cwd')
    }

    const workspaceRoot = path.resolve(cwd)
    if (this.configuredRoot !== undefined && workspaceRoot !== this.configuredRoot) {
      return unavailable('the Harness session workspace does not match the configured RepoAtlas workspace restriction')
    }

    const existing = this.runtimes.get(session)
    if (existing) {
      if (existing.workspaceRoot !== workspaceRoot) return unavailable('the Harness session workspace changed after RepoAtlas state was created')
      return { ok: true, execution, runtime: existing }
    }

    const config = createConfig(workspaceRoot, this.pluginConfig)
    const runtime: HarnessSessionRuntime = {
      session,
      workspaceRoot,
      config,
      proposalManager: new ChangeProposalManager(config),
    }
    this.runtimes.set(session, runtime)
    return { ok: true, execution, runtime }
  }
}

function unavailable(reason: string): HarnessSessionRuntimeResolution {
  return { ok: false, reason }
}
