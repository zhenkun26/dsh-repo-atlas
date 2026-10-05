import test from 'node:test'
import assert from 'node:assert/strict'
import { readinessOrigin } from '../scripts/harness-readiness.mjs'

test('Harness authenticated readiness URLs expose only a loopback origin', () => {
  for (const suffix of ['', '/', '/?token=synthetic', '/#key=synthetic', ' (LAN: http://192.0.2.1:9000)']) {
    assert.equal(readinessOrigin(`startup\ndsh web: http://127.0.0.1:9000${suffix}\n`), 'http://127.0.0.1:9000')
  }
})

test('Harness readiness rejects external, malformed and non-listening origins', () => {
  for (const value of ['http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:9000.evil.test',
    'http://127.0.0.1:9000@evil.test', 'http://0.0.0.0:9000', 'http://example.test:9000', 'https://127.0.0.1:9000']) {
    assert.equal(readinessOrigin(`dsh web: ${value}\n`), undefined)
  }
})
