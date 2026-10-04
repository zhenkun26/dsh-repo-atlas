import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { isAbsolute, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { harnessTarget } from './harness-target.mjs'

const repoRoot = resolve(process.cwd())
const harnessRoot = process.env.REPO_ATLAS_HARNESS_ROOT
const target = harnessTarget(repoRoot)
assert.equal(typeof harnessRoot, 'string', 'REPO_ATLAS_HARNESS_ROOT is required')
assert.ok(isAbsolute(harnessRoot), 'REPO_ATLAS_HARNESS_ROOT must be absolute')
assert.equal(execFileSync('git', ['-C', harnessRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', shell: false }).trim(), target.revision)
assert.equal(execFileSync('git', ['-C', harnessRoot, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', shell: false }).trim(), '')

// This component probe runs official emitted Cordis/Cosmokit code. It does not
// substitute for packaged Loader/Web activation and never changes upstream files.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/cosmokit') return { url: pathToFileURL(join(harnessRoot, 'vendor/cosmokit/lib/types/index.js')).href, shortCircuit: true }
  return nextResolve(specifier, context)
} })
try {
  const { Context, Service, symbols } = await import(pathToFileURL(join(harnessRoot, 'vendor/cordis/lib/types/index.js')).href)
  const { createHarnessRepositoryReader } = await import(pathToFileURL(join(repoRoot, 'dist/harness/repository-reader.js')).href)
  assert.equal(symbols.original, Symbol.for('cordis.original'))
  class FixtureFs extends Service {
    calls = []
    constructor(ctx) { super(ctx, 'repo-atlas-proxy-fixture') }
    async resolve() { this.calls.push(this.ctx.callerMarker); return { targetKey: 'opaque-component-fixture', displayPath: 'fixture' } }
    processPath() { return '/execution/fixture' }
    processPathFromHostPath() { return undefined }
    contains() { return true }
    async stat() { return { type: 'directory', version: 'fixture-version' } }
    async lstat() { return { type: 'directory', version: 'fixture-version' } }
    async listDir() { return [] }
    async readBytes() { throw new Error('Identity probe must not read source') }
  }
  const ctx = new Context()
  const service = new FixtureFs(ctx)
  const consumer = ctx.extend({ callerMarker: 'consumer-context' })
  const firstProxy = consumer.get('repo-atlas-proxy-fixture', false)
  const secondProxy = consumer.get('repo-atlas-proxy-fixture', false)
  assert.notEqual(firstProxy, secondProxy)
  assert.equal(firstProxy[symbols.original], service)
  const workspaceRoot = resolve('virtual-cordis-component-fixture')
  const first = await createHarnessRepositoryReader(firstProxy, workspaceRoot)
  const second = await createHarnessRepositoryReader(secondProxy, workspaceRoot)
  assert.equal(first.identity, second.identity)
  assert.deepEqual(service.calls, ['consumer-context', 'consumer-context'])
  ctx.set('repo-atlas-proxy-fixture', Object.create(service))
  const replacement = await createHarnessRepositoryReader(consumer.get('repo-atlas-proxy-fixture', false), workspaceRoot)
  assert.notEqual(replacement.identity, first.identity)
  console.log(`PASS: official Cordis proxy identity and caller-context component at ${target.revision}; not Loader/Web acceptance.`)
} finally { hooks.deregister() }
