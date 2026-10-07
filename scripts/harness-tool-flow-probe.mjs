import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { redactSecretLike } from '../dist/safety/content-policy.js'

export const name = 'repo-atlas-runtime-probe'
export const inject = ['tools', 'agents', 'fs']

/** Keyless calls through the real registry and real Agents after Loader startup. */
export function apply(ctx, config) {
  const ready = ctx.get('appReady')
  if (!ready) throw new Error('Runtime probe requires the public profile launcher')
  ctx.effect(() => ready.onReady(() => {
    void exercise().then(checks => record({ status: 'PASS', checks }), error => record({ status: 'FAIL',
      reason: redactSecretLike(error instanceof Error ? error.message : String(error)).text.slice(0, 1_000) }))
  }), 'repo-atlas runtime probe')

  function record(value) { writeFileSync(config.recordPath, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }) }

  async function exercise() {
    const handles = []
    try {
      for (const name of ['repo_atlas_analyze', 'repo_atlas_search', 'repo_atlas_impact', 'repo_atlas_change_proposal']) assert.ok(ctx.tools.get(name))
      assert.equal(ctx.tools.get('repo_atlas_symbols'), undefined)
      const first = await ctx.agents.create({ sessionId: `repo-atlas-probe-${randomUUID()}`, meta: { cwd: config.workspaceRoot } })
      handles.push(first)
      const call = async (name, args, agent = first.agent) => {
        const outcome = await ctx.tools.execute({ callId: randomUUID(), name, arguments: args, agent, signal: new AbortController().signal })
        assert.equal(outcome.isError, false, `Native ${name} failed: ${redactSecretLike(JSON.stringify(outcome.error ?? {})).text}`)
        return outcome.value
      }
      assert.ok((await call('repo_atlas_search', { query: 'repoAtlasSmokeCore' })).blocked)
      assert.ok((await call('repo_atlas_analyze', { start: 'direct' })).report)
      const search = await call('repo_atlas_search', { query: 'repoAtlasSmokeCore' })
      assert.equal(search.result.reader, 'harness')
      assert.ok(search.result.hits.some(hit => hit.sourcePath === 'src/core.ts'))
      const impact = await call('repo_atlas_impact', { targets: ['src/core.ts'] })
      assert.ok(impact.result.affected.some(hit => hit.sourcePath === 'src/index.ts'))
      const second = await ctx.agents.create({ sessionId: `repo-atlas-probe-${randomUUID()}`, meta: { cwd: config.workspaceRoot } })
      handles.push(second)
      assert.ok((await call('repo_atlas_search', { query: 'repoAtlasSmokeCore' }, second.agent)).blocked)
      const controller = new AbortController()
      controller.abort()
      const interrupted = await ctx.tools.execute({ callId: randomUUID(), name: 'repo_atlas_analyze', arguments: { start: 'direct' }, agent: first.agent, signal: controller.signal })
      assert.ok(interrupted.isError || interrupted.value?.blocked)
      return ['four-default-tools', 'symbols-opt-in', 'query-before-analysis-blocked', 'native-provider-analysis',
        'evidence-search', 'reverse-import-impact', 'same-cwd-session-isolation', 'caller-cancellation']
    } finally {
      for (const handle of handles.reverse()) await handle.dispose()
    }
  }
}
