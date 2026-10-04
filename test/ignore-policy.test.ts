import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRootIgnorePolicy } from '../src/repository/ignore-policy.ts'

test('positive ignore patterns match root anchors, basenames, directories and bounded wildcards', () => {
  const policy = parseRootIgnorePolicy('/root.ts\ncache/\n*.log\nsrc/**/generated?.ts\n**/temp.ts\n')
  for (const [name, directory] of [['root.ts', false], ['a/cache', true], ['a/cache/file.ts', false], ['a/trace.log', false], ['src/generated1.ts', false], ['src/a/b/generated2.ts', false], ['a/temp.ts', false]] as const) assert.equal(policy.ignored(name, directory), true, name)
  for (const name of ['a/root.ts', 'cache.ts', 'src/generated12.ts', 'a/xtemp.ts']) assert.equal(policy.ignored(name), false, name)
  assert.equal(policy.unsupported, 0)
})

test('unsupported ignore syntax and rule limits remain explicit', () => {
  const policy = parseRootIgnorePolicy('!include.ts\n[ab].ts\nname with space\n' + 'x'.repeat(257) + '\n' + Array.from({ length: 129 }, (_, i) => `file${i}`).join('\n'))
  assert.equal(policy.unsupported, 5)
  assert.equal(policy.ignored('include.ts'), false)
  assert.equal(policy.ignored('file127'), true)
  assert.equal(policy.ignored('file128'), false)
})
