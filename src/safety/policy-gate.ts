import { checkWorkspacePath, type PathCheck } from './path-policy.ts'
import { isSensitivePath } from './content-policy.ts'
import type { AuditEvent, PolicyDecision, RepoAtlasConfig, ToolAction } from '../types.ts'

const READONLY_ACTIONS = new Set<ToolAction>(['list', 'read', 'search', 'parse-config', 'parse-ast'])

export function decideAction(config: RepoAtlasConfig, action: ToolAction, requestedPath?: string, userConfirmedExport = false, checkPath: (root: string, requestedPath: string) => PathCheck = checkWorkspacePath): PolicyDecision {
  const auditId = `audit-${crypto.randomUUID()}`
  if (action === 'export-report' && userConfirmedExport) {
    const check = checkWorkspacePath(config.workspaceRoot, requestedPath ?? '.')
    return {
      allowed: check.allowed,
      action,
      reason: check.allowed ? 'explicit user-confirmed report export' : check.reason,
      path: check.absolutePath,
      auditId,
    }
  }
  if (!READONLY_ACTIONS.has(action)) {
    return { allowed: false, action, reason: 'v1 policy denies side effects by default', auditId, path: requestedPath }
  }
  if (!requestedPath) return { allowed: true, action, reason: 'read-only action without a path argument', auditId }
  const check = checkPath(config.workspaceRoot, requestedPath)
  if (!check.allowed) return { allowed: false, action, reason: check.reason, path: check.absolutePath, auditId }
  const relative = check.absolutePath.slice(config.workspaceRoot.length).replace(/^[/\\]/, '')
  if (isSensitivePath(relative, config.sensitiveFilePatterns)) {
    return { allowed: false, action, reason: 'sensitive path is denied', path: check.absolutePath, auditId }
  }
  return { allowed: true, action, reason: 'read-only action allowed inside workspace', path: check.absolutePath, auditId }
}

export function auditDecision(decision: PolicyDecision, detail?: string): AuditEvent {
  return {
    auditId: decision.auditId,
    timestamp: new Date().toISOString(),
    action: decision.action,
    status: decision.allowed ? 'allowed' : 'denied',
    path: decision.path,
    reason: decision.reason,
    detail,
  }
}

export function isRepositoryInstruction(text: string): boolean {
  return /ignore (all|previous|system)|override (policy|permission)|run this command|send .* to|upload/i.test(text)
}
