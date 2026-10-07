import path from 'node:path'
import type { ArchitectureEdge, Evidence, ScannedFile } from '../types.ts'

export interface UnresolvedImport {
  sourcePath: string
  moduleSpecifier: string
  evidenceId: string
  reason: 'external-or-alias' | 'outside-snapshot-or-ambiguous' | 'unverified-module-specifier'
}

/** Resolve only observed files; never guess that a directory means its first child. */
export function resolveLocalImport(source: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return undefined
  if (specifier.includes('\\') || /[\u0000-\u001f?#]/.test(specifier)) return undefined
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier))
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return undefined
  if (files.has(base)) return base
  // TypeScript source often imports the emitted JavaScript filename.
  const emitted = base.match(/\.(js|jsx|mjs|cjs)$/)
  const extensions = emitted
    ? ({ js: ['.ts', '.tsx'], jsx: ['.tsx'], mjs: ['.mts'], cjs: ['.cts'] }[emitted[1]] ?? [])
    : path.posix.extname(base) ? [] : ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
  const stem = emitted ? base.slice(0, -emitted[0].length) : base
  const candidates = extensions.map(extension => `${stem}${extension}`).filter(file => files.has(file))
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) return undefined
  if (path.posix.extname(base)) return undefined
  const indexes = extensions.map(extension => `${base}/index${extension}`).filter(file => files.has(file))
  return indexes.length === 1 ? indexes[0] : undefined
}

/** Pure graph construction over the already policy-filtered analysis snapshot. */
export function buildDependencyGraph(files: readonly ScannedFile[], evidence: readonly Evidence[]): {
  edges: ArchitectureEdge[]
  unresolved: UnresolvedImport[]
} {
  const paths = new Set(files.filter(file => file.kind === 'text').map(file => file.relativePath))
  const edges = new Map<string, ArchitectureEdge>()
  const unresolved = new Map<string, UnresolvedImport>()
  for (const item of evidence) {
    const observation = item.astObservation
    if (!paths.has(item.sourcePath) || item.evidenceKind !== 'ast' || typeof observation?.moduleSpecifier !== 'string') continue
    if (!['import', 'export'].includes(observation.kind)) continue
    if (!['syntax-confirmed', 'inferred'].includes(item.status)) continue
    const specifier = observation.moduleSpecifier
    const target = observation.moduleSpecifierExact === true ? resolveLocalImport(item.sourcePath, specifier, paths) : undefined
    if (!target) {
      const key = `${item.sourcePath}\0${specifier}`
      unresolved.set(key, {
        sourcePath: item.sourcePath, moduleSpecifier: specifier, evidenceId: item.evidenceId,
        reason: observation.moduleSpecifierExact !== true ? 'unverified-module-specifier' : specifier.startsWith('.') ? 'outside-snapshot-or-ambiguous' : 'external-or-alias',
      })
      continue
    }
    const key = `${item.sourcePath}\0${target}`
    const status = item.astParser === 'typescript-compiler' && item.status === 'syntax-confirmed' ? 'syntax-confirmed' : 'inferred'
    const existing = edges.get(key)
    if (existing) {
      if (!existing.evidenceIds.includes(item.evidenceId)) existing.evidenceIds.push(item.evidenceId)
      if (status === 'syntax-confirmed') existing.status = status
    } else {
      edges.set(key, { from: item.sourcePath, to: target, relation: 'imports', evidenceIds: [item.evidenceId], status })
    }
  }
  return {
    edges: [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    unresolved: [...unresolved.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.moduleSpecifier.localeCompare(b.moduleSpecifier)),
  }
}
