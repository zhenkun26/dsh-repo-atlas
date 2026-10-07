import { confirmGoal, refineGoal } from './clarification/goal.ts'
import { analyzeRepository } from './repository/analyze.ts'
import type { AnalysisSession, GoalSpec, RepoAtlasConfig } from './types.ts'
import type { RepositoryReader } from './repository/reader.ts'

export async function refineAndAnalyze(session: AnalysisSession, patch: Partial<GoalSpec>, overrides: Partial<Omit<RepoAtlasConfig, 'workspaceRoot'>> = {}, signal?: AbortSignal, reader?: RepositoryReader): Promise<AnalysisSession> {
  const draft = refineGoal(session.goal, patch)
  const goal = patch.confirmed ? confirmGoal(draft) : draft
  if (!goal.confirmed) throw new Error('Refined GoalSpec requires confirmation before analysis')
  const scope = goal.scope?.filter(Boolean)
  if (session.reader?.kind === 'harness' && !reader) throw new Error('Provider-backed refinement requires its repository reader; local fallback is denied')
  return analyzeRepository(goal, session.workspaceRoot, { ...overrides, scope }, signal, session.evidence, session.evidenceCache, reader)
}
