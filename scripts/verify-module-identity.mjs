import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [mode, requestedCompiler, ...extra] = process.argv.slice(2)
if (extra.length || (mode !== '--fallback' && mode !== '--compiler') || (mode === '--compiler') !== Boolean(requestedCompiler)) {
  throw new Error('Usage: node scripts/verify-module-identity.mjs --fallback | --compiler /path/to/typescript')
}
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'repo-atlas-module-identity-'))
writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
for (const file of ['repository/ast-parser.ts', 'repository/dependency-graph.ts', 'safety/content-policy.ts']) {
  mkdirSync(dirname(join(root, 'src', file)), { recursive: true })
  copyFileSync(join(projectRoot, 'src', file), join(root, 'src', file))
}
copyFileSync(join(projectRoot, 'scripts/fixtures/module-identity-probe.mjs'), join(root, 'probe.mjs'))
if (requestedCompiler) {
  const compiler = realpathSync(requestedCompiler)
  const metadata = JSON.parse(readFileSync(join(compiler, 'package.json'), 'utf8'))
  if (metadata.name !== 'typescript' || metadata.version !== '6.0.3') throw new Error('Expected the already installed official Harness TypeScript 6.0.3 package')
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(compiler, join(root, 'node_modules', 'typescript'), 'junction')
}
try {
  const output = execFileSync(process.execPath, ['--experimental-strip-types', join(root, 'probe.mjs')], {
    cwd: root, env: { ...process.env, NODE_PATH: '', MODULE_IDENTITY_MODE: mode },
    encoding: 'utf8', shell: false, timeout: 15_000, maxBuffer: 64 * 1024,
  })
  console.log(output.trim())
  console.log('PASS: module identity regressions; retained isolated source probe at ' + root)
} catch (error) {
  console.error('FAIL: module identity regressions; retained isolated source probe at ' + root)
  throw error
}
