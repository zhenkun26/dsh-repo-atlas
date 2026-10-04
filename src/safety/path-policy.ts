import fs from 'node:fs'
import path from 'node:path'

export interface PathCheck {
  allowed: boolean
  absolutePath: string
  reason: string
}

export function checkWorkspacePath(workspaceRoot: string, requestedPath: string): PathCheck {
  const lexical = checkLexicalWorkspacePath(workspaceRoot, requestedPath)
  if (!lexical.allowed) return lexical
  const root = path.resolve(workspaceRoot)
  const absolutePath = lexical.absolutePath
  const rootReal = safeRealpath(root)
  const existing = nearestExistingPath(absolutePath)
  const existingReal = safeRealpath(existing)
  if (!rootReal || !existingReal || !isWithin(rootReal, existingReal)) {
    return { allowed: false, absolutePath, reason: 'path or symlink resolves outside workspace' }
  }
  return { allowed: true, absolutePath, reason: 'path is inside workspace' }
}

/** Lexical containment only; a provider must additionally validate canonical targets. */
export function checkLexicalWorkspacePath(workspaceRoot: string, requestedPath: string): PathCheck {
  const root = path.resolve(workspaceRoot)
  const raw = String(requestedPath)
  if (/[\u0000-\u001f]/.test(raw)) return { allowed: false, absolutePath: root, reason: 'control characters are not allowed in paths' }
  if (raw.split(/[\\/]/).includes('..')) {
    return { allowed: false, absolutePath: path.resolve(root, raw), reason: 'path traversal segment is not allowed' }
  }
  const absolutePath = path.resolve(root, raw)
  if (!isWithin(root, absolutePath)) {
    return { allowed: false, absolutePath, reason: 'path is outside workspace' }
  }
  return { allowed: true, absolutePath, reason: 'path is inside workspace' }
}

export function assertWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  const result = checkWorkspacePath(workspaceRoot, requestedPath)
  if (!result.allowed) throw new Error(`Workspace path denied: ${result.reason}`)
  return result.absolutePath
}

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function nearestExistingPath(candidate: string): string {
  let current = candidate
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

function safeRealpath(candidate: string): string | undefined {
  try {
    return fs.realpathSync(candidate)
  } catch {
    return undefined
  }
}
