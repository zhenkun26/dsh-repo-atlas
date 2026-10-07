import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

test('isolated fallback parser keeps semantic identity separate from display and rejects ambiguous literals', () => {
  const output = execFileSync(process.execPath, [path.join(process.cwd(), 'scripts/verify-module-identity.mjs'), '--fallback'], {
    encoding: 'utf8', shell: false, timeout: 20_000, maxBuffer: 64 * 1024,
  })
  assert.match(output, /"parser":"bounded-structural"/)
  assert.match(output, /PASS: module identity regressions/)
})
