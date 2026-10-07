import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { RepositoryScanner } from '../src/repository/scanner.ts'

const fixture = (...parts: string[]) => path.join(process.cwd(), 'test', 'fixtures', ...parts)

test('scanner lists readable files and excludes sensitive/default generated paths', async () => {
  const scanner = new RepositoryScanner(fixture('complete-repo'))
  const result = await scanner.discover()
  assert.ok(result.files.some((file) => file.relativePath === 'package.json'))
  assert.ok(!result.files.some((file) => file.relativePath.startsWith('node_modules/')))
  const readme = await scanner.readText('README.md')
  assert.equal(readme.status, 'confirmed')
  assert.match(readme.text ?? '', /Fixture App/)
})

test('scanner discovers fingerprints without full reads when root ignore policy reading is disabled', async () => {
  const scanner = new RepositoryScanner(fixture('complete-repo'), { respectGitIgnore: false })
  const result = await scanner.discover()
  const readme = result.files.find((file) => file.relativePath === 'README.md')
  assert.ok(readme?.fingerprint)
  assert.equal(readme?.fingerprint?.relativePath, 'README.md')
  assert.equal(readme?.fingerprint?.sizeBytes, readme?.sizeBytes)
  assert.ok(Number.isFinite(readme?.fingerprint?.mtimeMs))
  assert.ok(Number.isFinite(readme?.fingerprint?.ctimeMs))
  assert.equal(result.budget.readBytes, 0)
})

test('scanner skips sensitive paths and redacts secret-like content', async () => {
  const scanner = new RepositoryScanner(fixture('sensitive-repo'))
  const result = await scanner.discover()
  assert.equal(result.files.find((file) => file.relativePath === '.env')?.kind, 'sensitive')
  const readme = await scanner.readText('README.md')
  assert.equal(readme.redacted, true)
  assert.doesNotMatch(readme.text ?? '', /sk-testvalue1234567890/)
  const env = await scanner.readText('.env')
  assert.equal(env.status, 'safety-skipped')
})

test('scanner preserves partial failures and budget statuses', async () => {
  const scanner = new RepositoryScanner(fixture('partial-repo'), { maxFileBytes: 4, maxTotalBytes: 5, maxActions: 2 })
  const result = await scanner.discover()
  assert.ok(result.files.some((file) => file.kind === 'too-large'))
  const broken = await scanner.readText('broken.json')
  assert.equal(broken.status, 'budget-exhausted')
  const imageScanner = new RepositoryScanner(fixture('partial-repo'))
  const image = await imageScanner.readText('image.bin')
  assert.equal(image.status, 'safety-skipped')
  const parseScanner = new RepositoryScanner(fixture('partial-repo'), { maxFileBytes: 100 })
  const parsed = await parseScanner.parseConfig('broken.json')
  assert.equal(parsed.status, 'read-failed')
  const controller = new AbortController()
  controller.abort()
  const interrupted = await parseScanner.readText('big.txt', controller.signal)
  assert.equal(interrupted.status, 'interrupted')
})

test('incremental rereads continue to honor read budget and AbortSignal', async () => {
  const budgetScanner = new RepositoryScanner(fixture('complete-repo'), { maxTotalBytes: 1 })
  await budgetScanner.discover()
  const budgetResult = await budgetScanner.readText('README.md')
  assert.equal(budgetResult.status, 'budget-exhausted')
  assert.equal(budgetScanner.snapshot().budget.readBytes, 0)

  const controller = new AbortController()
  controller.abort()
  const interrupted = await budgetScanner.readText('src/index.ts', controller.signal)
  assert.equal(interrupted.status, 'interrupted')
  assert.equal(interrupted.redacted, false)
})
