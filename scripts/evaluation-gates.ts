interface SetResult {
  missing: string[]
  unexpected: string[]
}

export interface EvaluationResult {
  edgeMetrics: SetResult
  graphReferencesValid: boolean
  retrieval: Array<SetResult & { snapshotReferenceIntegrity: boolean }>
  impact: SetResult & { truncated: boolean; unknownTargets: string[]; evidenceReferencesValid: boolean }
  unresolved: SetResult
  unsupportedRelationsExcluded: boolean
  redactionPassed: boolean
  sensitivePathsExcluded: boolean
  expectedBudgetStatusMatched: boolean
}

export interface EvaluationExpectation {
  expectCompleteCoverage?: boolean
  expectedUnknownTargets?: string[]
}

/** Small complete cases enforce recall; intentionally partial baselines keep measured deficits. */
export function evaluationGateFailures(result: EvaluationResult, expectation: EvaluationExpectation): string[] {
  const failures: string[] = []
  if (result.edgeMetrics.unexpected.length) failures.push('false-resolved-edge')
  if (!result.graphReferencesValid) failures.push('graph-reference-integrity')
  if (result.retrieval.some(query => !query.snapshotReferenceIntegrity)) failures.push('retrieval-reference-integrity')
  if (!result.impact.evidenceReferencesValid) failures.push('impact-reference-integrity')
  if (!result.unsupportedRelationsExcluded) failures.push('unsupported-relation-resolved')
  if (!result.redactionPassed) failures.push('redaction')
  if (!result.sensitivePathsExcluded) failures.push('sensitive-path')
  if (!result.expectedBudgetStatusMatched) failures.push('budget-status')
  if (expectation.expectCompleteCoverage) {
    if (result.edgeMetrics.missing.length) failures.push('missing-resolved-edge')
    if (result.retrieval.some(query => query.missing.length)) failures.push('missing-relevant-file')
    if (result.impact.missing.length || result.impact.unexpected.length || result.impact.truncated) failures.push('incomplete-impact')
    if (result.unresolved.missing.length || result.unresolved.unexpected.length) failures.push('unresolved-import-mismatch')
  }
  if (expectation.expectedUnknownTargets !== undefined) {
    const actual = new Set(result.impact.unknownTargets)
    const expected = new Set(expectation.expectedUnknownTargets)
    if (actual.size !== expected.size || [...actual].some(target => !expected.has(target))) failures.push('unknown-target-mismatch')
  }
  return failures
}
