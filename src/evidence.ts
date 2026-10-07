import { randomUUID } from 'node:crypto'
import { redactSecretLike } from './safety/content-policy.ts'
import type { AnalysisStatus, AstObservation, AstParser, Conclusion, Evidence } from './types.ts'

export function createEvidence(sourcePath: string, locator: string, observation: string, status: AnalysisStatus, alreadyRedacted = false, metadata: { evidenceKind?: 'text' | 'ast'; astObservation?: AstObservation; astParser?: AstParser } = {}): Evidence {
  const redacted = alreadyRedacted ? { text: observation, redacted: false } : redactSecretLike(observation)
  return {
    evidenceId: `evidence-${randomUUID()}`,
    sourcePath,
    locator,
    observation: redacted.text,
    status,
    redactionState: redacted.redacted ? 'redacted' : alreadyRedacted ? 'not-applicable' : 'clean',
    ...metadata,
  }
}

export function addConclusion(target: Conclusion[], text: string, status: AnalysisStatus, evidenceIds: string[]): Conclusion {
  const conclusion: Conclusion = { conclusionId: `conclusion-${randomUUID()}`, text, status, evidenceIds: [...new Set(evidenceIds)] }
  target.push(conclusion)
  return conclusion
}

export function validateConclusionEvidence(conclusions: Conclusion[], evidence: Evidence[]): Array<{ conclusionId: string; valid: boolean; reason?: string }> {
  const known = new Map(evidence.map((item) => [item.evidenceId, item]))
  return conclusions.map((conclusion) => {
    if (conclusion.status === 'unconfirmed' || conclusion.status === 'not-analyzed') return { conclusionId: conclusion.conclusionId, valid: true }
    if (!conclusion.evidenceIds.length) return { conclusionId: conclusion.conclusionId, valid: false, reason: 'material conclusion has no evidence' }
    const missing = conclusion.evidenceIds.filter((id) => !known.has(id))
    return missing.length ? { conclusionId: conclusion.conclusionId, valid: false, reason: `missing evidence: ${missing.join(', ')}` } : { conclusionId: conclusion.conclusionId, valid: true }
  })
}
