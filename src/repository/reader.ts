import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { checkWorkspacePath, checkLexicalWorkspacePath, isWithin, type PathCheck } from '../safety/path-policy.ts'

export interface ReaderStat {
  type: 'file' | 'directory' | 'symlink' | 'other'
  size?: number
  version?: string
  mtimeMs?: number
  ctimeMs?: number
}

export interface ReaderEntry { name: string; type: ReaderStat['type'] }

/** A read-only port. Relative names never contain provider target keys or URIs. */
export interface RepositoryReader {
  readonly workspaceRoot: string
  readonly identity: string
  readonly kind: 'local' | 'harness'
  readonly hostBacked: boolean
  checkPath(requestedPath: string): PathCheck
  list(relativePath: string, signal?: AbortSignal, maxEntries?: number): Promise<ReaderEntry[]>
  stat(relativePath: string, signal?: AbortSignal): Promise<ReaderStat | undefined>
  read(relativePath: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
}

export class LocalRepositoryReader implements RepositoryReader {
  readonly workspaceRoot: string
  readonly identity = 'local-node'
  readonly kind = 'local' as const
  readonly hostBacked = true

  constructor(workspaceRoot: string) { this.workspaceRoot = path.resolve(workspaceRoot) }

  checkPath(requestedPath: string): PathCheck { return checkWorkspacePath(this.workspaceRoot, requestedPath) }

  async list(relativePath: string, signal?: AbortSignal, maxEntries = 5_000): Promise<ReaderEntry[]> {
    const target = await this.target(relativePath, signal)
    const entries = []
    for await (const entry of await fs.opendir(target)) {
      signal?.throwIfAborted()
      if (entries.length >= maxEntries) throw new Error('directory listing exceeds the entry cap')
      entries.push(entry)
    }
    if (await this.target(relativePath, signal) !== target) throw new Error('directory identity changed during listing')
    return entries.map(entry => ({ name: entry.name, type: entry.isSymbolicLink() ? 'symlink' as const : entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : 'other' as const }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  }

  async stat(relativePath: string, signal?: AbortSignal): Promise<ReaderStat | undefined> {
    try {
      const target = await this.target(relativePath, signal)
      const stat = await fs.lstat(target)
      signal?.throwIfAborted()
      return { type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other', size: stat.size,
        version: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async read(relativePath: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    const target = await this.target(relativePath, signal)
    const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size > maxBytes) throw new Error('file exceeds bounded regular-file read')
      const chunks: Buffer[] = []
      let total = 0
      while (total < before.size) {
        signal?.throwIfAborted()
        const chunk = Buffer.alloc(Math.min(65_536, before.size - total))
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)
        if (!bytesRead) throw new Error('file changed during bounded read')
        chunks.push(chunk.subarray(0, bytesRead))
        total += bytesRead
      }
      signal?.throwIfAborted()
      const after = await handle.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('file changed during bounded read')
      if (await this.target(relativePath, signal) !== target) throw new Error('resolved path changed during bounded read')
      const current = await fs.stat(target)
      if (current.dev !== after.dev || current.ino !== after.ino || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) throw new Error('file identity changed during bounded read')
      return Buffer.concat(chunks, total)
    } finally { await handle.close() }
  }

  private async target(relativePath: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const check = this.checkPath(relativePath)
    if (!check.allowed) throw new Error(`Workspace path denied: ${check.reason}`)
    const relative = path.relative(this.workspaceRoot, check.absolutePath)
    let prefix = this.workspaceRoot
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      prefix = path.join(prefix, segment)
      if ((await fs.lstat(prefix)).isSymbolicLink()) throw new Error('symbolic link skipped by default')
    }
    const [root, resolved] = await Promise.all([fs.realpath(this.workspaceRoot), fs.realpath(check.absolutePath)])
    if (!isWithin(root, resolved)) throw new Error('resolved path is outside workspace')
    signal?.throwIfAborted()
    return resolved
  }
}

export function relativeReaderPath(reader: RepositoryReader, requestedPath: string): string {
  const check = checkLexicalWorkspacePath(reader.workspaceRoot, requestedPath)
  if (!check.allowed) throw new Error(`Workspace path denied: ${check.reason}`)
  return path.relative(reader.workspaceRoot, check.absolutePath).split(path.sep).join('/') || '.'
}
