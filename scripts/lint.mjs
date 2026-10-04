import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const files = []
function collectFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(path)
    else if (entry.isFile()) files.push(path)
  }
}
collectFiles('src')
files.sort()

const forbidden = /(?:from\s+['"]node:child_process|import\s+.*child_process|\b(?:exec|fetch|rmSync|unlink|rename)\s*\(|https?:\/\/)/
const capabilitySpawn = /\bspawn\s*\(/g
const violations = []
for (const file of files) {
  const text = await readFile(file, 'utf8')
  const directSpawn = capabilitySpawn.test(text)
  capabilitySpawn.lastIndex = 0
  const spawnOutsideAdapter = directSpawn && !file.endsWith('/actions/runtime.ts') && !file.endsWith('/repository/git-worktree-adapter.ts')
  const fixedGitAdapter = file.endsWith('/repository/git-worktree-adapter.ts')
  if ((forbidden.test(text) || spawnOutsideAdapter) && !file.includes('/reporting/report.ts') && !fixedGitAdapter) violations.push(file)
}
if (violations.length) {
  console.error(`FAIL: forbidden side-effect token found in ${violations.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`PASS: lightweight safety lint scanned ${files.length} files.`)
}
