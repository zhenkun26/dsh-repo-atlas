import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildArtifact, filesUnder } from '../scripts/build-artifact.mjs'

const compilerPath = path.resolve('node_modules/typescript/bin/tsc')

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-atlas-build-test-'))
  mkdirSync(path.join(root, 'src', 'harness'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'build-fixture', type: 'module', scripts: { prepack: 'exit 99' } }))
  for (const file of ['cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE.md']) writeFileSync(path.join(root, file), 'fixture\n')
  writeFileSync(path.join(root, 'tsconfig.build.json'), JSON.stringify({
    compilerOptions: { module: 'NodeNext', target: 'ES2022', declaration: true, rootDir: 'src', sourceMap: true, declarationMap: true }, include: ['src/**/*.ts'],
  }))
  writeFileSync(path.join(root, 'src', 'index.ts'), 'export const version = 1\n')
  writeFileSync(path.join(root, 'src', 'harness', 'plugin.ts'), 'export const name = "fixture"\n')
  return root
}

test('isolated builds preserve unrelated and stale outputs and allocate independent packages', () => {
  const root = project()
  mkdirSync(path.join(root, 'dist'))
  writeFileSync(path.join(root, 'dist', 'obsolete.js'), 'retain me')
  const first = buildArtifact({ projectRoot: root, compilerPath, projectDist: false })
  writeFileSync(path.join(root, 'src', 'index.ts'), 'export const version = 2\n')
  const second = buildArtifact({ projectRoot: root, compilerPath, projectDist: false })
  assert.notEqual(first.packageRoot, second.packageRoot)
  assert.equal(readFileSync(path.join(root, 'dist', 'obsolete.js'), 'utf8'), 'retain me')
  assert.match(readFileSync(path.join(first.packageRoot, 'dist', 'index.js'), 'utf8'), /version = 1/)
  assert.match(readFileSync(path.join(second.packageRoot, 'dist', 'index.js'), 'utf8'), /version = 2/)
  assert.ok(!filesUnder(second.packageRoot).some(file => file.includes('obsolete')))
  const manifest = JSON.parse(readFileSync(path.join(second.packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts, undefined)
  assert.doesNotMatch(readFileSync(path.join(first.packageRoot, 'dist', 'index.js.map'), 'utf8'), /repo-atlas-build-test-/)
})

test('normal build preserves package dist entry and refuses foreign outputs before projection', () => {
  const root = project()
  const first = buildArtifact({ projectRoot: root, compilerPath })
  const original = readFileSync(path.join(root, 'dist', 'index.js'), 'utf8')
  assert.equal(original, readFileSync(path.join(first.packageRoot, 'dist', 'index.js'), 'utf8'))
  writeFileSync(path.join(root, 'dist', 'foreign.js'), 'retain me')
  writeFileSync(path.join(root, 'src', 'index.ts'), 'export const version = 3\n')
  assert.throws(() => buildArtifact({ projectRoot: root, compilerPath }), /outputs absent from this build/)
  assert.equal(readFileSync(path.join(root, 'dist', 'index.js'), 'utf8'), original)
  assert.equal(readFileSync(path.join(root, 'dist', 'foreign.js'), 'utf8'), 'retain me')
})

test('failed compilation retains a failed record and never projects a fresh dist', () => {
  const root = project()
  writeFileSync(path.join(root, 'src', 'index.ts'), 'export const broken: number = "wrong"\n')
  assert.throws(() => buildArtifact({ projectRoot: root, compilerPath }), /Build failed; artifacts retained/)
  assert.ok(!readdirSync(root).includes('dist'))
  const runs = path.join(root, '.codex', 'artifacts')
  const record = JSON.parse(readFileSync(path.join(runs, readdirSync(runs)[0], 'result.json'), 'utf8'))
  assert.equal(record.status, 'failed')
  assert.deepEqual(record.files, [])
})

test('symbolic-link dist is rejected and its target remains intact', { skip: process.platform === 'win32' ? 'Windows symlink privileges require separate acceptance' : false }, () => {
  const root = project()
  const outside = mkdtempSync(path.join(tmpdir(), 'repo-atlas-build-outside-'))
  writeFileSync(path.join(outside, 'sentinel.txt'), 'unchanged')
  symlinkSync(outside, path.join(root, 'dist'), 'dir')
  assert.throws(() => buildArtifact({ projectRoot: root, compilerPath }), /real directory/)
  assert.equal(readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'unchanged')
})
