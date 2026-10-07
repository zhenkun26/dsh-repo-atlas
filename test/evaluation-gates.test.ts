import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluationGateFailures } from '../scripts/evaluation-gates.ts'
import type { EvaluationResult } from '../scripts/evaluation-gates.ts'

function completeResult(): EvaluationResult {
  return {
    edgeMetrics: { missing: [], unexpected: [] }, graphReferencesValid: true,
    retrieval: [{ missing: [], unexpected: ['README.md'], snapshotReferenceIntegrity: true }],
    impact: { missing: [], unexpected: [], truncated: false, unknownTargets: ['missing.ts'], evidenceReferencesValid: true },
    unresolved: { missing: [], unexpected: [] }, unsupportedRelationsExcluded: true,
    redactionPassed: true, sensitivePathsExcluded: true, expectedBudgetStatusMatched: true,
  }
}

test('complete evaluation gates reject missed edges, retrieval, impact and unresolved labels', () => {
  const expectation = { expectCompleteCoverage: true, expectedUnknownTargets: ['missing.ts'] }
  assert.deepEqual(evaluationGateFailures(completeResult(), expectation), [])
  const mutations: Array<[string, (result: EvaluationResult) => void]> = [
    ['missing-resolved-edge', result => result.edgeMetrics.missing.push('app.ts->lib.ts')],
    ['missing-relevant-file', result => result.retrieval[0].missing.push('lib.ts')],
    ['incomplete-impact', result => result.impact.missing.push('app.ts')],
    ['incomplete-impact', result => result.impact.unexpected.push('unrelated.ts')],
    ['incomplete-impact', result => { result.impact.truncated = true }],
    ['unresolved-import-mismatch', result => result.unresolved.missing.push('app.ts:@alias/lib')],
    ['unresolved-import-mismatch', result => result.unresolved.unexpected.push('app.ts:./lib')],
    ['unknown-target-mismatch', result => { result.impact.unknownTargets = [] }],
    ['unknown-target-mismatch', result => result.impact.unknownTargets.push('observed.ts')],
  ]
  for (const [failure, mutate] of mutations) {
    const result = completeResult()
    mutate(result)
    assert.deepEqual(evaluationGateFailures(result, expectation), [failure])
  }
})

test('partial evaluation preserves low recall while rejecting false edges and unsafe references', () => {
  const partial = completeResult()
  partial.edgeMetrics.missing.push('unobserved.ts->tail.ts')
  partial.retrieval[0].missing.push('tail.ts')
  partial.impact.missing.push('unobserved.ts')
  partial.impact.truncated = true
  partial.unresolved.missing.push('unobserved.ts:@alias/lib')
  assert.deepEqual(evaluationGateFailures(partial, {}), [])
  const mutations: Array<[string, (result: EvaluationResult) => void]> = [
    ['false-resolved-edge', result => result.edgeMetrics.unexpected.push('app.ts->wrong.ts')],
    ['graph-reference-integrity', result => { result.graphReferencesValid = false }],
    ['retrieval-reference-integrity', result => { result.retrieval[0].snapshotReferenceIntegrity = false }],
    ['impact-reference-integrity', result => { result.impact.evidenceReferencesValid = false }],
    ['unsupported-relation-resolved', result => { result.unsupportedRelationsExcluded = false }],
    ['redaction', result => { result.redactionPassed = false }],
    ['sensitive-path', result => { result.sensitivePathsExcluded = false }],
    ['budget-status', result => { result.expectedBudgetStatusMatched = false }],
  ]
  for (const [failure, mutate] of mutations) {
    const result = structuredClone(partial)
    mutate(result)
    assert.deepEqual(evaluationGateFailures(result, {}), [failure])
  }
})
