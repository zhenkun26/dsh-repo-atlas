import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseAstSource } from './src/repository/ast-parser.ts'
import { buildDependencyGraph } from './src/repository/dependency-graph.ts'

const compiler = process.env.MODULE_IDENTITY_MODE === '--compiler'
let compilerVersion
if (compiler) {
  const api = createRequire(import.meta.url)('typescript')
  assert.equal(api.version, '6.0.3')
  assert.equal(typeof api.createSourceFile, 'function')
  compilerVersion = api.version
}
const options = { maxTokens: 1000, maxObservations: 20, maxObservationTextBytes: 120 }
let checks = 0
function graph(source, paths) {
  const parsed = parseAstSource('main.ts', source, options)
  assert.equal(parsed.parser, compiler ? 'typescript-compiler' : 'bounded-structural')
  const evidence = parsed.observations.map((astObservation, i) => ({
    evidenceId: 'e' + i, sourcePath: 'main.ts', locator: '1', observation: astObservation.summary,
    status: 'syntax-confirmed', redactionState: 'clean', evidenceKind: 'ast', astParser: parsed.parser, astObservation,
  }))
  const files = ['main.ts', ...paths].map(relativePath => ({ relativePath, kind: 'text', sizeBytes: 1 }))
  checks++
  return { parsed, evidence, files, ...buildDependencyGraph(files, evidence) }
}
const spaced = graph("export { value } from './two  spaces.ts'\n", ['two  spaces.ts', 'two spaces.ts'])
assert.equal(spaced.parsed.observations[0].moduleSpecifier, './two  spaces.ts')
assert.equal(spaced.parsed.observations[0].moduleSpecifierExact, true)
assert.deepEqual(spaced.edges.map(e => e.to), ['two  spaces.ts'])
assert.equal(spaced.edges[0].status, compiler ? 'syntax-confirmed' : 'inferred')
const prefix = './' + 'a'.repeat(158)
const long = graph("export { value } from '" + prefix + "extra.ts'\n", [prefix.slice(2), prefix.slice(2) + 'extra.ts'])
assert.equal(long.parsed.observations[0].moduleSpecifierExact, false)
assert.deepEqual(long.edges, [])
assert.equal(long.unresolved[0].reason, 'unverified-module-specifier')
const ordinary = graph("import { value } from './lib.ts'\nexport { value } from './lib.ts'\n", ['lib.ts'])
assert.equal(ordinary.parsed.observations.length, 2)
assert.ok(ordinary.parsed.observations.every(o => o.moduleSpecifierExact === true))
assert.deepEqual(ordinary.edges.map(e => e.to), ['lib.ts'])
assert.deepEqual(ordinary.unresolved, [])
const escaped = graph('export { value } from "./two\\u0020spaces.ts"\n', ['two spaces.ts', 'twou0020spaces.ts'])
if (compiler) {
  assert.equal(escaped.parsed.observations[0].moduleSpecifier, './two spaces.ts')
  assert.equal(escaped.parsed.observations[0].moduleSpecifierExact, true)
  assert.deepEqual(escaped.edges.map(e => e.to), ['two spaces.ts'])
} else {
  assert.equal(escaped.parsed.observations[0].moduleSpecifierExact, false)
  assert.deepEqual(escaped.edges, [])
  assert.equal(escaped.unresolved[0].reason, 'unverified-module-specifier')
}
for (const specifier of ['./[REDACTED_SECRET].ts', './token=EXAMPLE_ONLY.ts']) {
  const redacted = graph("import '" + specifier + "'\n", [specifier.slice(2), 'token=[REDACTED_SECRET]'])
  assert.equal(redacted.parsed.observations[0].moduleSpecifierExact, false)
  assert.ok(!JSON.stringify(redacted.parsed.observations).includes('EXAMPLE_ONLY'))
  assert.deepEqual(redacted.edges, [])
  assert.equal(redacted.unresolved[0].reason, 'unverified-module-specifier')
}
const boundary = './' + 'a'.repeat(138) + '汉'.repeat(20)
assert.equal(boundary.length, 160)
assert.ok(Buffer.byteLength(boundary) > 160)
const exactBoundary = graph("import '" + boundary + "'\n", [boundary.slice(2)])
assert.equal(exactBoundary.parsed.observations[0].moduleSpecifierExact, true)
assert.deepEqual(exactBoundary.edges.map(e => e.to), [boundary.slice(2)])
const overBoundary = graph("import '" + boundary + "x'\n", [boundary.slice(2), boundary.slice(2) + 'x'])
assert.equal(overBoundary.parsed.observations[0].moduleSpecifierExact, false)
assert.deepEqual(overBoundary.edges, [])
const legacy = structuredClone(ordinary.evidence)
for (const item of legacy) delete item.astObservation.moduleSpecifierExact
const legacyGraph = buildDependencyGraph(ordinary.files, legacy)
assert.deepEqual(legacyGraph.edges, [])
assert.equal(legacyGraph.unresolved[0].reason, 'unverified-module-specifier')
checks++
if (!compiler) {
  for (const source of ['import ' + String.fromCharCode(96) + './' + '$' + '{name}.ts' + String.fromCharCode(96), "import './two\nspaces.ts'"]) {
    const unreliable = graph(source, ['two spaces.ts', '$' + '{name}.ts'])
    assert.equal(unreliable.parsed.observations[0].moduleSpecifierExact, false)
    assert.deepEqual(unreliable.edges, [])
    assert.equal(unreliable.unresolved[0].reason, 'unverified-module-specifier')
  }
}
console.log(JSON.stringify({ parser: compiler ? 'typescript-compiler' : 'bounded-structural', compilerVersion, checks }))
