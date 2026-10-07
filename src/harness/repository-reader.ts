import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { checkLexicalWorkspacePath, type PathCheck } from '../safety/path-policy.ts'
import { relativeReaderPath, type ReaderEntry, type ReaderStat, type RepositoryReader } from '../repository/reader.ts'

export interface HarnessFsTarget { targetKey: string; displayPath: string }
export interface HarnessFileSystem {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<HarnessFsTarget>
  processPath(target: HarnessFsTarget): string
  processPathFromHostPath?(hostPath: string): string | undefined
  contains(parent: HarnessFsTarget, child: HarnessFsTarget): boolean
  stat(target: HarnessFsTarget, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other'; size?: number; version: string } | undefined>
  lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'symlink' | 'other'; size?: number; version: string } | undefined>
  listDir(target: HarnessFsTarget, signal?: AbortSignal): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other'; target: HarnessFsTarget; size?: number; version?: string }>>
  readBytes(target: HarnessFsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
}

const providerIdentities = new WeakMap<object, string>()

export async function createHarnessRepositoryReader(provider: HarnessFileSystem, workspaceRoot: string, signal?: AbortSignal): Promise<RepositoryReader> {
  for (const name of ['resolve', 'processPath', 'contains', 'stat', 'lstat', 'listDir', 'readBytes'] as const) {
    if (typeof provider?.[name] !== 'function') throw new Error(`Harness filesystem lacks required ${name} capability`)
  }
  signal?.throwIfAborted()
  const root = await provider.resolve('.', { cwd: workspaceRoot, signal })
  const info = await provider.stat(root, signal)
  if (info?.type !== 'directory') throw new Error('Harness workspace target must be a directory')
  // Cordis exports this shared identity symbol; ctx.get creates fresh traced wrappers.
  // Unwrap for identity only. Operations retain the caller-bound proxy above.
  const original = (provider as unknown as Record<symbol, unknown>)[Symbol.for('cordis.original')]
  const identityOwner = original && (typeof original === 'object' || typeof original === 'function') ? original : provider
  let id = providerIdentities.get(identityOwner)
  if (!id) { id = `harness-${randomUUID()}`; providerIdentities.set(identityOwner, id) }
  const mapped = provider.processPathFromHostPath?.(workspaceRoot)
  return new HarnessRepositoryReader(provider, workspaceRoot, root, `${id}:${createHash('sha256').update(root.targetKey).digest('hex')}`, mapped !== undefined && mapped === provider.processPath(root))
}

class HarnessRepositoryReader implements RepositoryReader {
  readonly kind = 'harness' as const
  private readonly provider: HarnessFileSystem
  readonly workspaceRoot: string
  private readonly root: HarnessFsTarget
  readonly identity: string
  readonly hostBacked: boolean
  constructor(provider: HarnessFileSystem, workspaceRoot: string, root: HarnessFsTarget, identity: string, hostBacked: boolean) {
    this.provider = provider
    this.workspaceRoot = workspaceRoot
    this.root = root
    this.identity = identity
    this.hostBacked = hostBacked
  }

  checkPath(requestedPath: string): PathCheck { return checkLexicalWorkspacePath(this.workspaceRoot, requestedPath) }

  async list(relativePath: string, signal?: AbortSignal, maxEntries = 5_000): Promise<ReaderEntry[]> {
    const target = await this.target(relativePath, signal)
    const entries = await this.provider.listDir(target, signal)
    if (!Array.isArray(entries) || entries.length > maxEntries) throw new Error('Harness directory listing exceeds the entry cap')
    const names = new Set<string>()
    const result: ReaderEntry[] = []
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (!validBasename(entry.name) || names.has(entry.name)) throw new Error('Harness directory listing has unsafe or duplicate names')
      names.add(entry.name)
      const child = relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`
      const info = await this.provider.lstat(child, { cwd: this.workspaceRoot }, signal)
      if (info?.type === 'symlink') { result.push({ name: entry.name, type: 'symlink' }); continue }
      if (!this.provider.contains(this.root, entry.target)) throw new Error('Harness listing target is outside workspace')
      result.push({ name: entry.name, type: info?.type ?? 'other' })
    }
    return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  }

  async stat(relativePath: string, signal?: AbortSignal): Promise<ReaderStat | undefined> {
    const target = await this.target(relativePath, signal)
    return this.provider.stat(target, signal)
  }

  async read(relativePath: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    const target = await this.target(relativePath, signal)
    const before = await this.provider.stat(target, signal)
    if (before?.type !== 'file' || before.size === undefined || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes) throw new Error('Harness file lacks bounded regular-file metadata')
    const content = await this.provider.readBytes(target, signal, maxBytes)
    signal?.throwIfAborted()
    if (!(content instanceof Uint8Array) || content.byteLength > maxBytes) throw new Error('Harness read exceeded its requested byte cap')
    const after = await this.provider.stat(target, signal)
    const current = await this.target(relativePath, signal)
    if (content.byteLength !== before.size || !before.version || before.version !== after?.version || current.targetKey !== target.targetKey) throw new Error('Harness file changed during bounded read')
    return content
  }

  private async target(requestedPath: string, signal?: AbortSignal): Promise<HarnessFsTarget> {
    signal?.throwIfAborted()
    const relative = relativeReaderPath(this, requestedPath)
    let prefix = ''
    for (const part of relative === '.' ? [] : relative.split('/')) {
      prefix = prefix ? `${prefix}/${part}` : part
      const info = await this.provider.lstat(prefix, { cwd: this.workspaceRoot }, signal)
      if (info?.type === 'symlink') throw new Error('symbolic link skipped by default')
    }
    const target = await this.provider.resolve(relative, { cwd: this.workspaceRoot, signal })
    if (!this.provider.contains(this.root, target)) throw new Error('Harness resolved target is outside workspace')
    return target
  }
}

function validBasename(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\\/\u0000-\u001f]/.test(name) && !path.isAbsolute(name)
}
