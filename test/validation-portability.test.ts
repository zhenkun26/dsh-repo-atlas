import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const lintScript = path.resolve('scripts/lint.mjs')

function lintFixture(files: Record<string, string>) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'repo-atlas lint fixture '))
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(cwd, 'src', relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  return spawnSync(process.execPath, [lintScript], { cwd, shell: false, encoding: 'utf8' })
}

test('safety lint preserves exact adapter and report exceptions with native paths', () => {
  const result = lintFixture({
    'actions/runtime.ts': 'subprocess.spawn(spec)\n',
    'repository/git-worktree-adapter.ts': "import { execFile } from 'node:child_process'\nsubprocess.spawn(spec)\n",
    'reporting/report.ts': 'const link = "https://example.test/report"\n',
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /scanned 3 files/)
})

test('safety lint still rejects side effects outside exact exceptions', () => {
  const result = lintFixture({
    'unrelated/runtime.ts': 'subprocess.spawn(spec)\n',
    'repository/git-worktree-adapter-extra.ts': "import { execFile } from 'node:child_process'\n",
    'reporting/report-extra.ts': 'const link = "https://example.test/report"\n',
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  for (const file of ['runtime.ts', 'git-worktree-adapter-extra.ts', 'report-extra.ts']) assert.ok(result.stderr.includes(file))
})
