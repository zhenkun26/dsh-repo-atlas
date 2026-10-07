import { harnessTarget } from './harness-target.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const repoRoot = resolve(process.cwd())
const harnessRoot = process.env.REPO_ATLAS_HARNESS_ROOT
let contractRoot

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function run(executable, args, options = {}) {
  try {
    return execFileSync(executable, args, {
      encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 2 * 1024 * 1024, timeout: 120_000, ...options,
    })
  } catch (error) {
    const detail = error && typeof error === 'object'
      ? [error.stdout, error.stderr].filter(Boolean).join('\n').trim().slice(0, 4_000)
      : ''
    throw new Error(`official Harness API typecheck failed${detail ? `: ${detail}` : ''}`)
  }
}

function moduleSpecifier(path) {
  return path.replaceAll('\\', '/')
}

try {
  assertCondition(typeof harnessRoot === 'string' && isAbsolute(harnessRoot), 'REPO_ATLAS_HARNESS_ROOT must be an absolute path')
  const compatibility = harnessTarget(repoRoot)
  const revision = run('git', ['-C', harnessRoot, 'rev-parse', 'HEAD']).trim()
  assertCondition(revision === compatibility.revision, `Harness checkout is ${revision}, expected ${compatibility.revision}`)
  const trackedStatus = run('git', ['-C', harnessRoot, 'status', '--porcelain', '--untracked-files=no']).trim()
  assertCondition(trackedStatus === '', 'Harness checkout has tracked changes; official API evidence requires a clean checkout')

  contractRoot = mkdtempSync(join(tmpdir(), 'repo-atlas-harness-api-'))
  const publicTypes = moduleSpecifier(join(repoRoot, 'dist', 'harness', 'public.js'))
  const plugin = moduleSpecifier(join(repoRoot, 'dist', 'harness', 'plugin.js'))
  assertCondition(existsSync(join(repoRoot, 'dist', 'harness', 'public.d.ts')), 'RepoAtlas built declarations are missing; run npm run build first')
  assertCondition(existsSync(join(repoRoot, 'dist', 'harness', 'plugin.d.ts')), 'RepoAtlas Harness declaration is missing; run npm run build first')
  const probePath = join(contractRoot, 'contract.ts')
  const configPath = join(contractRoot, 'tsconfig.json')

  const candidateImports = compatibility.candidate ? `
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { LspService } from '@deepseek-ai/dsh-lsp'
import type { HarnessFileSystem } from '${moduleSpecifier(join(repoRoot, 'dist/harness/repository-reader.js'))}'
import type { HarnessLspService } from '${moduleSpecifier(join(repoRoot, 'dist/harness/symbol-tool.js'))}'
` : ''
  const candidateAssertions = compatibility.candidate ? `
type _Fs = Assert<FileSystem extends HarnessFileSystem ? true : false>
type _Lsp = Assert<LspService extends HarnessLspService ? true : false>
` : ''
  writeFileSync(probePath, `
${candidateImports}
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { GoalService } from '@deepseek-ai/dsh-goal'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { apply } from '${plugin}'
import type {
  HarnessApprovalService, HarnessGoalService, HarnessPluginContext,
  HarnessSandboxPolicyService, HarnessTool, HarnessToolExecution,
} from '${publicTypes}'

type Assert<T extends true> = T
${candidateAssertions}
type _ToolDefinition = Assert<HarnessTool extends ToolDefinition ? true : false>
type _Execution = Assert<ToolRunContext extends HarnessToolExecution ? true : false>
type _Approval = Assert<ApprovalService extends HarnessApprovalService ? true : false>
type _Goals = Assert<GoalService extends HarnessGoalService ? true : false>
type _Policy = Assert<SandboxPolicyService extends HarnessSandboxPolicyService ? true : false>

declare const ctx: Context
declare const exec: ToolRunContext
declare const tool: HarnessTool
declare const approval: ApprovalService
declare const goals: GoalService
declare const policy: SandboxPolicyService

const localContext: HarnessPluginContext = ctx
const officialTool: ToolDefinition = tool
const localExecution: HarnessToolExecution = exec
apply(ctx)
ctx.tools.register(officialTool)
void approval.request({ agent: exec.agent!, toolName: exec.name, callId: exec.callId, signal: exec.signal })
void goals.get(exec.agent!)
const resolved = policy.resolve({ session: exec.agent?.session, mode: 'read-only' })
ctx.sandbox.confine(['node', '--version'], { ...resolved, mode: 'read-only' })
ctx.subprocess.spawn({
  argv: ['node', '--version'], cwd: resolved.workspaceRoot,
  stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
  graceMs: 1000, signal: exec.signal,
})
void localContext
void localExecution
void (null as unknown as SandboxProvider)
void (null as unknown as SubprocessRuntime)
`, 'utf8')

  writeFileSync(configPath, `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      noEmit: true, strict: true, skipLibCheck: true,
      exactOptionalPropertyTypes: false, noUncheckedIndexedAccess: false,
      allowImportingTsExtensions: true,
      paths: {
        ...(compatibility.candidate ? {
          '@deepseek-ai/dsh-fs': [join(harnessRoot, 'packages/fs/fs/lib/types/index.d.ts')],
          '@deepseek-ai/dsh-lsp': [join(harnessRoot, 'packages/lsp/lsp/lib/types/index.d.ts')],
        } : {}),
        '@deepseek-ai/cordis': [join(harnessRoot, 'vendor/cordis/lib/types/index.d.ts')],
        '@deepseek-ai/dsh-tools': [join(harnessRoot, 'packages/core/tools/lib/types/index.d.ts')],
        '@deepseek-ai/dsh-user-approval': [join(harnessRoot, 'packages/interaction/user-approval/lib/types/index.d.ts')],
        '@deepseek-ai/dsh-goal': [join(harnessRoot, 'packages/goal/goal/lib/types/index.d.ts')],
        '@deepseek-ai/dsh-sandbox-policy': [join(harnessRoot, 'packages/sandbox/sandbox-policy/lib/types/index.d.ts')],
        '@deepseek-ai/dsh-sandbox': [join(harnessRoot, 'packages/sandbox/sandbox/lib/types/index.d.ts')],
        '@deepseek-ai/dsh-subprocess': [join(harnessRoot, 'packages/subprocess/subprocess/lib/types/index.d.ts')],
      },
      typeRoots: [join(harnessRoot, 'node_modules', '@types'), join(repoRoot, 'node_modules', '@types')],
    },
    files: [probePath],
  }, null, 2)}\n`, 'utf8')

  run(join(repoRoot, 'node_modules', '.bin', 'tsc'), ['--project', configPath], { cwd: harnessRoot })
  if (compatibility.candidate) process.stdout.write(run('node', [join(repoRoot, 'scripts/verify-harness-proxy-identity.mjs'), '--candidate'], { cwd: repoRoot }))
  console.log(`PASS: RepoAtlas public API contract matches DeepSeek Harness ${compatibility.revision}.`)
} catch (error) {
  console.error(`FAIL: Harness public API contract: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (contractRoot) console.log(`Artifacts retained at ${contractRoot}; no cleanup performed.`)
}
