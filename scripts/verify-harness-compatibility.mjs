import { harnessTarget } from './harness-target.mjs'
import { readinessEndpoint } from './harness-readiness.mjs'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = resolve(process.cwd())
const harnessRoot = process.env.REPO_ATLAS_HARNESS_ROOT
const MAX_OUTPUT_BYTES = 64 * 1024
const STARTUP_TIMEOUT_MS = 90_000
const SHUTDOWN_TIMEOUT_MS = 10_000
let dshHome
let child
let childOwnsProcessGroup = false
let harnessPnpm
let harnessCli
let flowPatch
let flowRecord

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function run(executable, args, options = {}) {
  try {
    return execFileSync(executable, args, {
      cwd: harnessRoot, encoding: 'utf8', shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000, ...options,
    })
  } catch (error) {
    const command = [executable, ...args].join(' ')
    const detail = error && typeof error === 'object'
      ? [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
      : ''
    const status = error && typeof error === 'object' ? error.code ?? error.status ?? error.signal : undefined
    throw new Error(`${command} failed (${String(status ?? 'unknown')})${detail ? `: ${detail.slice(-2_000)}` : ''}`)
  }
}

function sanitizedEnvironment() {
  const safe = Object.fromEntries(Object.entries(process.env).filter(([key]) => {
    return !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)
  }))
  return { ...safe, CI: '1', DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1',
    PATH: `${join(harnessRoot, 'node_modules', '.bin')}${process.platform === 'win32' ? ';' : ':'}${safe.PATH ?? ''}` }
}

function appendBounded(current, chunk, streamName) {
  const next = current + chunk.toString('utf8')
  if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) throw new Error(`Harness ${streamName} exceeded the ${MAX_OUTPUT_BYTES}-byte smoke budget`)
  return next
}

function signalOwnedChild(signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (childOwnsProcessGroup && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') throw error
  }
}

async function waitForOwnedExit(timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child?.off('exit', onExit)
      resolveExit(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timeout)
      resolveExit(true)
    }
    child.once('exit', onExit)
  })
}

async function stopOwnedChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true
  signalOwnedChild('SIGTERM')
  if (await waitForOwnedExit(SHUTDOWN_TIMEOUT_MS)) return true
  signalOwnedChild('SIGKILL')
  return waitForOwnedExit(5_000)
}

async function bootAndProbe(environment) {
  let stdout = ''
  let stderr = ''
  let settled = false
  childOwnsProcessGroup = process.platform !== 'win32'
  child = spawn(process.execPath, [harnessCli, 'web', ...(flowPatch ? ['--patch', flowPatch] : []), '--port', '0', '--no-open'], {
    cwd: harnessRoot, env: environment, shell: false, detached: childOwnsProcessGroup, stdio: ['ignore', 'pipe', 'pipe'],
  })

  const ready = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error('Harness Web readiness timed out')), STARTUP_TIMEOUT_MS)
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }
    child.once('error', (error) => finish(rejectReady, new Error(`Harness Web failed to start: ${error.message}`)))
    child.once('exit', (code, signal) => finish(rejectReady, new Error(`Harness Web exited before readiness (code=${String(code)}, signal=${String(signal)}): ${stderr.slice(-2_000)}`)))
    child.stdout.on('data', (chunk) => {
      try {
        stdout = appendBounded(stdout, chunk, 'stdout')
        const url = readinessEndpoint(stdout)
        if (url) finish(resolveReady, url)
      } catch (error) {
        finish(rejectReady, error)
      }
    })
    child.stderr.on('data', (chunk) => {
      try {
        stderr = appendBounded(stderr, chunk, 'stderr')
      } catch (error) {
        finish(rejectReady, error)
      }
    })
  })

  const url = await ready
  const parsed = new URL(url)
  assertCondition(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port !== '', 'Harness readiness URL was not bounded to an explicit loopback port')
  let response = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
  if (response.status >= 300 && response.status < 400) {
    // Follow the public browser bootstrap, keeping the one-time key and cookies
    // in memory. Do not disable the Host authentication fence for this check.
    const cookies = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
    assertCondition(cookies.length > 0, 'Harness bootstrap did not establish a browser cookie')
    const location = new URL(response.headers.get('location') ?? '/', parsed)
    assertCondition(location.origin === parsed.origin, 'Harness bootstrap redirected outside its loopback origin')
    await response.body?.cancel()
    response = await fetch(location, { headers: { cookie: cookies }, redirect: 'manual', signal: AbortSignal.timeout(5_000) })
  }
  assertCondition(response.status >= 200 && response.status < 400, `Harness Web loopback probe returned HTTP ${response.status}`)
  await response.body?.cancel()
  if (flowRecord) {
    const deadline = Date.now() + 20_000
    while (!existsSync(flowRecord) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    assertCondition(existsSync(flowRecord), 'Native tool flow did not settle within its budget')
    const flow = JSON.parse(readFileSync(flowRecord, 'utf8'))
    assertCondition(flow.status === 'PASS', 'Native tool flow failed; its retained record does not establish acceptance')
    console.log(`PASS: official native tool flow (${flow.checks.length} checks); no model request or human UI acceptance.`)
  }
  assertCondition(await stopOwnedChild(), 'Harness Web process tree did not terminate within the shutdown budget')
}

try {
  assertCondition(typeof harnessRoot === 'string' && isAbsolute(harnessRoot), 'REPO_ATLAS_HARNESS_ROOT must be an absolute path')
  const compatibility = harnessTarget(repoRoot)
  assertCondition(compatibility.repository === 'https://github.com/deepseek-ai/deepseek-harness.git', 'unexpected Harness repository')
  assertCondition(typeof compatibility.ref === 'string' && compatibility.ref.length > 0, 'Harness target ref is missing')
  assertCondition(compatibility.profile === 'web', 'unexpected Harness profile')
  assertCondition(compatibility.node === '24.x', 'unexpected Harness Node compatibility pin')
  assertCondition(compatibility.packageManager === 'pnpm@11.7.0', 'unexpected Harness package-manager pin')

  const revision = run('git', ['-C', harnessRoot, 'rev-parse', 'HEAD']).trim()
  assertCondition(revision === compatibility.revision, `Harness checkout is ${revision}, expected the public pin`)
  const trackedStatus = run('git', ['-C', harnessRoot, 'status', '--porcelain', '--untracked-files=no']).trim()
  assertCondition(trackedStatus === '', 'Harness checkout has tracked changes; compatibility evidence requires a clean checkout')
  harnessPnpm = join(harnessRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  const packageManagerVersion = run(process.execPath, [harnessPnpm, '--version']).trim()
  assertCondition(`pnpm@${packageManagerVersion}` === compatibility.packageManager, 'installed Harness package manager does not match its pin')
  harnessCli = join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js')

  dshHome = mkdtempSync(join(tmpdir(), 'repo-atlas-harness-smoke-'))
  const environment = sanitizedEnvironment()
  run(process.execPath, [harnessCli, 'plugin', '--profile', compatibility.profile, 'add', repoRoot], { env: environment, timeout: 600_000 })
  const config = run(process.execPath, [harnessCli, '--profile', compatibility.profile, '--dump-config'], { env: environment })
  assertCondition(config.includes('dsh-repo-atlas/harness'), 'composed web profile did not include dsh-repo-atlas/harness')
  run('node', [join(repoRoot, 'scripts', 'verify-harness-api-contract.mjs'), ...(compatibility.candidate ? ['--candidate'] : [])], { cwd: repoRoot, env: environment })
  if (compatibility.candidate) {
    const workspace = join(dshHome, 'probe-workspace')
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'README.md'), '# RepoAtlas native runtime fixture\n')
    writeFileSync(join(workspace, 'package.json'), '{"name":"repo-atlas-native-fixture"}\n')
    writeFileSync(join(workspace, 'src/core.ts'), 'export function repoAtlasSmokeCore() { return 1 }\n')
    writeFileSync(join(workspace, 'src/index.ts'), "import { repoAtlasSmokeCore } from './core.ts'\nexport const answer = repoAtlasSmokeCore()\n")
    flowPatch = join(dshHome, 'probe.patch.json')
    flowRecord = join(dshHome, 'tool-flow.json')
    writeFileSync(flowPatch, JSON.stringify([{ insert: [{ id: 'repo-atlas-runtime-probe',
      name: pathToFileURL(join(repoRoot, 'scripts', 'harness-tool-flow-probe.mjs')).href,
      config: { workspaceRoot: workspace, recordPath: flowRecord } }] }]))
  }
  await bootAndProbe(environment)

  console.log(`PASS: DeepSeek Harness ${compatibility.revision} ${compatibility.profile} live boot smoke.`)
} catch (error) {
  await stopOwnedChild()
  console.error(`FAIL: DeepSeek Harness compatibility smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (dshHome) console.log(`Artifacts retained at ${dshHome}; no cleanup performed.`)
}
