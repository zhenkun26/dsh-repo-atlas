import test from 'node:test'
import assert from 'node:assert/strict'
import { jsonOutput } from '../src/harness/json-output.ts'

test('Harness DTO projection omits only absent object fields without mutating its producer', () => {
  const shared = { optional: undefined, zero: 0, flag: false, text: '', none: null }
  const original = { first: shared, second: shared, list: [shared], absent: undefined }
  const value = jsonOutput(original)
  assert.deepEqual(value, { first: { zero: 0, flag: false, text: '', none: null }, second: { zero: 0, flag: false, text: '', none: null }, list: [{ zero: 0, flag: false, text: '', none: null }] })
  assert.equal(Object.hasOwn(original, 'absent'), true)
  assert.equal(Object.hasOwn(shared, 'optional'), true)
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
  assert.equal(Object.getPrototypeOf(jsonOutput(JSON.parse('{"__proto__":{"safe":true}}'))), Object.prototype)
})

test('Harness DTO projection rejects lossy values, arrays, cycles and executable properties', () => {
  let invoked = false
  const getter = { get value() { invoked = true; return 1 } }
  class CustomArray extends Array<number> {}
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  for (const value of [undefined, NaN, Infinity, -0, 1n, () => 1, new Date(), new Map(), [undefined], Array(1),
    new CustomArray(1), Object.assign([1], { extra: 2 }), { [Symbol('private')]: 1 }, getter, cyclic]) assert.throws(() => jsonOutput(value), TypeError)
  assert.equal(invoked, false)
})
