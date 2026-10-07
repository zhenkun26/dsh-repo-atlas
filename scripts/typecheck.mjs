import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

try {
  if (!existsSync(compiler)) throw Object.assign(new Error('Workspace compiler is missing'), { code: 'ENOENT' })
  execFileSync(process.execPath, [compiler, '--noEmit'], { stdio: 'inherit', shell: false })
  console.log('PASS: TypeScript compiler completed.')
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('BLOCKED: tsc is not installed in this workspace; runtime tests still use Node type stripping.')
    process.exitCode = 2
  } else {
    process.exitCode = error.status ?? 1
  }
}
