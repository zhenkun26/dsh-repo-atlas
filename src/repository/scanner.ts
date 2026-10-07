import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseRootIgnorePolicy } from './ignore-policy.ts'
import { createConfig } from '../config.ts'
import { redactSecretLike, isSensitivePath } from '../safety/content-policy.ts'
import { decideAction, auditDecision } from '../safety/policy-gate.ts'
import { LocalRepositoryReader, relativeReaderPath, type ReaderStat, type RepositoryReader } from './reader.ts'
import { isPathCoveredByScope } from './evidence-cache.ts'
import { isAstSupportedPath, parseAstSource } from './ast-parser.ts'
import type { AstParseResult, AuditEvent, EvidenceFingerprint, ReadResult, RepoAtlasConfig, ScanResult, ScannedFile, ToolAction } from '../types.ts'

export class RepositoryScanner {
  readonly config: RepoAtlasConfig
  readonly reader: RepositoryReader
  private readonly scanned: ScannedFile[] = []
  private readonly skipped: Array<{ path: string; reason: string }> = []
  private readonly failures: Array<{ path: string; reason: string }> = []
  private readonly audits: AuditEvent[] = []
  private readBytes = 0
  private actionCount = 0
  private candidateFiles = 0
  private exhausted = false
  private ignoreLoaded = false
  private ignore = parseRootIgnorePolicy('')
  private ignoreHash = ''
  private nestedPoliciesObserved = 0
  private visitedDirectories = 0

  constructor(workspaceRoot: string, overrides: Partial<Omit<RepoAtlasConfig, 'workspaceRoot'>> = {}, reader?: RepositoryReader) {
    this.config = createConfig(workspaceRoot, overrides)
    this.reader = reader ?? new LocalRepositoryReader(this.config.workspaceRoot)
    if (path.resolve(this.reader.workspaceRoot) !== this.config.workspaceRoot) throw new Error('Repository reader workspace does not match configuration')
  }

  async discover(signal?: AbortSignal): Promise<ScanResult> {
    await this.loadIgnorePolicy(signal)
    for (const scope of this.config.scope ?? ['.']) {
      if (signal?.aborted || this.exhausted) break
      try { await this.walk(scope, signal, true) }
      catch (error) { this.failures.push({ path: scope, reason: errorMessage(error, this.reader.kind === 'harness') }) }
    }
    return this.snapshot()
  }

  async readText(relativePath: string, signal?: AbortSignal): Promise<ReadResult> {
    if (signal?.aborted) return this.interrupted(relativePath)
    const decision = this.beginAction('read', relativePath)
    if (!decision.allowed) return this.deniedRead(relativePath, decision.reason)
    const normalized = relativeReaderPath(this.reader, relativePath)
    if (!isPathCoveredByScope(normalized, this.config.scope)) return this.deniedRead(normalized, 'path is outside confirmed analysis scope')
    if (isSensitivePath(normalized, this.config.sensitiveFilePatterns)) return this.deniedRead(normalized, 'sensitive path is denied')
    await this.loadIgnorePolicy(signal)
    if (this.exhausted) return { relativePath: normalized, status: 'budget-exhausted', redacted: false, reason: 'policy or resource budget prevents reading' }
    if (this.ignore.ignored(normalized) || this.config.excludeDirs.some(directory => normalized.split('/').includes(directory) || normalized.startsWith(`${directory}/`))) return this.deniedRead(normalized, 'ignored path is denied')
    let stat
    try {
      stat = await this.reader.stat(normalized, signal)
    } catch (error) {
      return this.failedRead(normalized, errorMessage(error, this.reader.kind === 'harness'))
    }
    if (stat?.type !== 'file') return this.failedRead(normalized, 'not a regular file')
    if (stat.size === undefined || !Number.isSafeInteger(stat.size) || stat.size < 0) return this.failedRead(normalized, 'file byte size is unavailable')
    if (!stat.version && ![stat.mtimeMs, stat.ctimeMs].every(Number.isFinite)) return this.failedRead(normalized, 'stable file version metadata is unavailable')
    if (stat.size > this.config.maxFileBytes) {
      this.skip(normalized, 'file exceeds maxFileBytes')
      return { relativePath: normalized, status: 'budget-exhausted', redacted: false, reason: 'file exceeds maxFileBytes', sizeBytes: stat.size }
    }
    if (this.readBytes + stat.size > this.config.maxTotalBytes) {
      this.exhausted = true
      this.skip(normalized, 'total read budget exhausted')
      return { relativePath: normalized, status: 'budget-exhausted', redacted: false, reason: 'total read budget exhausted', sizeBytes: stat.size }
    }
    try {
      const readCap = stat.size
      this.readBytes += readCap // Reserve the entire I/O cap; failed or cancelled attempts are not refunded.
      const buffer = Buffer.from(await this.reader.read(normalized, readCap, signal))
      if (signal?.aborted) return this.interrupted(normalized)
      if (buffer.byteLength > stat.size || buffer.byteLength > this.config.maxFileBytes || this.readBytes > this.config.maxTotalBytes) {
        this.exhausted = true
        return { relativePath: normalized, status: 'budget-exhausted', redacted: false, reason: 'reader exceeded bounded metadata or read budget', sizeBytes: buffer.byteLength }
      }
      const after = await this.reader.stat(normalized, signal)
      if (buffer.byteLength !== stat.size || after?.type !== 'file' || after.size !== stat.size || after.version !== stat.version || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) return this.failedRead(normalized, 'file metadata changed during bounded read')
      const observed = this.scanned.find(file => file.relativePath === normalized)
      if (observed) observed.fingerprint = createFingerprint(normalized, after)
      if (looksBinary(buffer)) {
        this.skip(normalized, 'binary file')
        return { relativePath: normalized, status: 'safety-skipped', redacted: false, reason: 'binary file', sizeBytes: stat.size }
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      const redacted = redactSecretLike(decoded)
      return {
        relativePath: normalized,
        status: 'confirmed',
        text: redacted.text,
        redacted: redacted.redacted,
        sizeBytes: stat.size,
      }
    } catch (error) {
      return signal?.aborted ? this.interrupted(normalized) : this.failedRead(normalized, errorMessage(error, this.reader.kind === 'harness'))
    }
  }

  async search(query: string, relativePaths?: string[], signal?: AbortSignal, providedText?: ReadonlyMap<string, string>, observedText?: Map<string, string>, readPaths?: Set<string>): Promise<Array<{ path: string; line: number; text: string }>> {
    await this.loadIgnorePolicy(signal)
    const decision = this.beginAction('search', relativePaths?.[0] ?? '.')
    if (!decision.allowed) return []
    const pattern = new RegExp(query, 'i')
    const paths = relativePaths ?? this.scanned.filter((file) => file.kind === 'text').map((file) => file.relativePath)
    const matches: Array<{ path: string; line: number; text: string }> = []
    for (const candidate of paths) {
      if (signal?.aborted) break
      if (!this.eligiblePath(candidate)) continue
      let text: string | undefined
      if (providedText?.has(candidate)) {
        text = providedText.get(candidate)
      } else {
        const read = await this.readText(candidate, signal)
        readPaths?.add(candidate)
        text = read.text
        if (text !== undefined) observedText?.set(candidate, text)
      }
      if (!text) continue
      text.split('\n').forEach((line, index) => {
        if (pattern.test(line)) matches.push({ path: candidate, line: index + 1, text: line.slice(0, 500) })
      })
    }
    return matches
  }

  async parseConfig(relativePath: string, signal?: AbortSignal, providedText?: string): Promise<{ path: string; format: string; values: Record<string, unknown>; status: string }> {
    await this.loadIgnorePolicy(signal)
    const decision = this.beginAction('parse-config', relativePath)
    if (!decision.allowed || !this.eligiblePath(relativePath)) return { path: relativePath, format: 'unknown', values: {}, status: 'safety-skipped' }
    const read = providedText === undefined ? await this.readText(relativePath, signal) : { text: providedText, status: 'confirmed' as const }
    if (!read.text) return { path: relativePath, format: 'unknown', values: {}, status: read.status }
    const extension = path.extname(relativePath).toLowerCase()
    try {
      if (path.basename(relativePath).toLowerCase() === 'package.json' || extension === '.json') {
        const parsed = JSON.parse(read.text) as Record<string, unknown>
        return { path: relativePath, format: 'json', values: summarizeConfig(parsed), status: 'confirmed' }
      }
      if (['.toml', '.yaml', '.yml'].includes(extension)) {
        return { path: relativePath, format: extension.slice(1), values: summarizeLineConfig(read.text), status: 'inferred' }
      }
      if (path.basename(relativePath).toLowerCase() === 'go.mod') {
        const module = read.text.match(/^module\s+(.+)$/m)?.[1]?.trim()
        return { path: relativePath, format: 'go.mod', values: module ? { module } : {}, status: module ? 'confirmed' : 'unconfirmed' }
      }
      return { path: relativePath, format: 'text', values: {}, status: 'unconfirmed' }
    } catch (error) {
      this.failures.push({ path: relativePath, reason: `config parse failed: ${errorMessage(error)}` })
      this.audits.push({ auditId: `failure-${crypto.randomUUID()}`, timestamp: new Date().toISOString(), action: 'failure', status: 'failed', path: relativePath, reason: 'config parse failed', detail: errorMessage(error) })
      return { path: relativePath, format: extension.slice(1) || 'text', values: {}, status: 'read-failed' }
    }
  }

  async parseAst(relativePath: string, signal?: AbortSignal, providedText?: string): Promise<AstParseResult> {
    if (signal?.aborted) return astResult(relativePath, 'interrupted', 'unavailable', 'user interrupted AST analysis')
    await this.loadIgnorePolicy(signal)
    const decision = this.beginAction('parse-ast', relativePath)
    if (!decision.allowed) {
      const status = decision.reason.includes('budget') ? 'budget-exhausted' : 'safety-skipped'
      return astResult(relativePath, status, 'unavailable', decision.reason)
    }
    const normalized = relativeReaderPath(this.reader, relativePath)
    if (!this.eligiblePath(normalized)) return astResult(normalized, this.exhausted ? 'budget-exhausted' : 'safety-skipped', 'unavailable', 'path is outside the readable analysis policy')
    if (!isPathCoveredByScope(normalized, this.config.scope)) {
      this.skip(normalized, 'path is outside confirmed analysis scope')
      return astResult(normalized, 'safety-skipped', 'unavailable', 'path is outside confirmed analysis scope')
    }
    if (!isAstSupportedPath(normalized)) return parseAstSource(normalized, providedText ?? '', this.astOptions(signal))
    if (providedText === undefined) {
      const read = await this.readText(normalized, signal)
      if (read.text === undefined) return astResult(normalized, read.status, 'unavailable', read.reason ?? 'read did not produce text')
      providedText = read.text
    }
    return parseAstSource(normalized, redactSecretLike(providedText).text, this.astOptions(signal))
  }

  snapshot(): ScanResult {
    return {
      files: [...this.scanned],
      skipped: [...this.skipped],
      failures: [...this.failures],
      audits: [...this.audits],
      ignorePolicy: { mode: this.config.respectGitIgnore ? 'root-positive-patterns' : 'disabled', fingerprint: this.ignoreHash, unsupportedRuleCount: this.ignore.unsupported, nestedPoliciesObserved: this.nestedPoliciesObserved },
      budget: { candidateFiles: this.candidateFiles, readBytes: this.readBytes, actions: this.actionCount, exhausted: this.exhausted },
    }
  }

  private async walk(relativeDir: string, signal?: AbortSignal, explicitScope = false): Promise<void> {
    if (signal?.aborted || this.exhausted) return
    relativeDir = relativeReaderPath(this.reader, relativeDir)
    if (relativeDir !== '.' && (this.ignore.ignored(relativeDir) || isSensitivePath(relativeDir, this.config.sensitiveFilePatterns) ||
      this.config.excludeDirs.some(dir => relativeDir.split('/').includes(dir) || relativeDir === dir || relativeDir.startsWith(`${dir}/`)))) {
      this.skip(relativeDir, 'scope is excluded by the readable analysis policy'); return
    }
    if (++this.visitedDirectories > this.config.maxCandidateFiles) { this.exhausted = true; this.skip(relativeDir, 'directory discovery budget exhausted'); return }
    let entries
    try {
      const scopeInfo = explicitScope ? await this.reader.stat(relativeDir, signal) : undefined
      if (scopeInfo?.type === 'directory' && this.ignore.ignored(relativeDir, true)) { this.skip(relativeDir, 'scope directory is ignored'); return }
      if (scopeInfo?.type === 'file') {
        entries = [{ name: path.posix.basename(relativeDir), type: 'file' as const }]
        relativeDir = path.posix.dirname(relativeDir)
      } else entries = await this.reader.list(relativeDir, signal, this.config.maxCandidateFiles)
    } catch (error) {
      this.failures.push({ path: relativeDir, reason: errorMessage(error, this.reader.kind === 'harness') })
      return
    }
    for (const entry of entries) {
      if (signal?.aborted || this.exhausted) return
      if (!entry.name || entry.name === '.' || entry.name === '..' || /[\\/\u0000-\u001f]/.test(entry.name)) throw new Error('Repository listing contains an unsafe name')
      const relativePath = relativeDir === '.' ? entry.name : `${relativeDir}/${entry.name}`
      if (this.ignore.ignored(relativePath, entry.type === 'directory')) { this.skip(relativePath, 'root .gitignore positive pattern'); continue }
      if (entry.type === 'directory') {
        if (this.config.excludeDirs.includes(entry.name) || this.config.excludeDirs.some((excluded) => relativePath === excluded || relativePath.startsWith(`${excluded}/`))) {
          this.skip(relativePath, 'excluded directory')
          continue
        }
        await this.walk(relativePath, signal)
        continue
      }
      if (entry.type === 'symlink' || entry.type === 'other') {
        this.skip(relativePath, entry.type === 'symlink' ? 'symbolic link skipped by default' : 'not a regular file')
        continue
      }
      this.candidateFiles += 1
      if (entry.name === '.gitignore' && relativeDir !== '.') this.nestedPoliciesObserved++
      if (this.candidateFiles > this.config.maxCandidateFiles) {
        this.exhausted = true
        this.skip(relativePath, 'candidate file budget exhausted')
        this.audits.push({ auditId: `budget-${crypto.randomUUID()}`, timestamp: new Date().toISOString(), action: 'budget', status: 'skipped', path: relativePath, reason: 'candidate file budget exhausted' })
        return
      }
      if (isSensitivePath(relativePath, this.config.sensitiveFilePatterns)) {
        this.scanned.push({ relativePath, sizeBytes: 0, kind: 'sensitive' })
        this.skip(relativePath, 'sensitive path')
        continue
      }
      try {
        const stat = await this.reader.stat(relativePath, signal)
        if (stat?.type !== 'file' || stat.size === undefined || !Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error('regular file byte size is unavailable')
        const kind = stat.size > this.config.maxFileBytes ? 'too-large' : 'text'
        const fingerprint = createFingerprint(relativePath, stat)
        this.scanned.push({ relativePath, sizeBytes: stat.size, kind, fingerprint })
        if (kind === 'too-large') this.skip(relativePath, 'file exceeds maxFileBytes')
      } catch (error) {
        this.scanned.push({ relativePath, sizeBytes: 0, kind: 'unreadable' })
        this.failures.push({ path: relativePath, reason: errorMessage(error, this.reader.kind === 'harness') })
      }
    }
  }

  private beginAction(action: ToolAction, relativePath: string) {
    if (this.actionCount >= this.config.maxActions) {
      this.exhausted = true
      const decision = decideAction(this.config, action, relativePath, false, (_root, requested) => this.reader.checkPath(requested))
      this.audits.push({ ...auditDecision(decision, 'ReAct action budget exhausted'), action: 'budget', status: 'skipped', reason: 'ReAct action budget exhausted' })
      return { ...decision, allowed: false, reason: 'ReAct action budget exhausted' }
    }
    this.actionCount += 1
    const decision = decideAction(this.config, action, relativePath, false, (_root, requested) => this.reader.checkPath(requested))
    this.audits.push(auditDecision(decision))
    return decision
  }

  private async loadIgnorePolicy(signal?: AbortSignal): Promise<void> {
    if (this.ignoreLoaded || !this.config.respectGitIgnore || signal?.aborted) return
    this.ignoreLoaded = true
    try {
      const info = await this.reader.stat('.gitignore', signal)
      if (!info) return
      if (info.type !== 'file' || info.size === undefined || !Number.isSafeInteger(info.size) || info.size < 0 || info.size > Math.min(16_384, this.config.maxFileBytes)) throw new Error('root .gitignore lacks bounded regular-file metadata')
      if (!info.version && ![info.mtimeMs, info.ctimeMs].every(Number.isFinite)) throw new Error('root .gitignore lacks stable version metadata')
      if (info.size > this.config.maxTotalBytes - this.readBytes) throw new Error('root .gitignore exceeds the remaining read budget')
      const decision = this.beginAction('read', '.gitignore')
      if (!decision.allowed) throw new Error(decision.reason)
      const readCap = info.size
      this.readBytes += readCap
      const bytes = await this.reader.read('.gitignore', readCap, signal)
      const after = await this.reader.stat('.gitignore', signal)
      if (bytes.byteLength !== info.size || bytes.byteLength > 16_384 || this.readBytes > this.config.maxTotalBytes || after?.type !== 'file' || after.size !== info.size || info.version !== after.version || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) throw new Error('root .gitignore changed or exceeded its read cap')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      this.ignore = parseRootIgnorePolicy(text)
      this.ignoreHash = createHash('sha256').update(text).digest('hex')
    } catch (error) {
      this.failures.push({ path: '.gitignore', reason: errorMessage(error, this.reader.kind === 'harness') })
      this.exhausted = true
    }
  }

  private eligiblePath(requestedPath: string): boolean {
    const check = this.reader.checkPath(requestedPath)
    if (!check.allowed || this.exhausted) return false
    const normalized = relativeReaderPath(this.reader, requestedPath)
    return isPathCoveredByScope(normalized, this.config.scope) && !isSensitivePath(normalized, this.config.sensitiveFilePatterns) &&
      !this.ignore.ignored(normalized) && !this.config.excludeDirs.some(directory => normalized.split('/').includes(directory) || normalized === directory || normalized.startsWith(`${directory}/`))
  }

  private deniedRead(relativePath: string, reason: string): ReadResult {
    this.skip(relativePath, reason)
    return { relativePath, status: 'safety-skipped', redacted: false, reason }
  }

  private failedRead(relativePath: string, reason: string): ReadResult {
    this.failures.push({ path: relativePath, reason })
    return { relativePath, status: 'read-failed', redacted: false, reason }
  }

  private interrupted(relativePath: string): ReadResult {
    this.skip(relativePath, 'user interrupted analysis')
    return { relativePath, status: 'interrupted', redacted: false, reason: 'user interrupted analysis' }
  }

  private skip(relativePath: string, reason: string): void {
    this.skipped.push({ path: relativePath, reason })
    this.audits.push({ auditId: `skip-${crypto.randomUUID()}`, timestamp: new Date().toISOString(), action: 'skip', status: 'skipped', path: relativePath, reason })
  }

  private astOptions(signal?: AbortSignal) {
    return {
      signal,
      maxTokens: this.config.maxAstTokensPerFile,
      maxObservations: this.config.maxAstObservationsPerFile,
      maxObservationTextBytes: this.config.maxAstObservationTextBytes,
    }
  }
}

function astResult(relativePath: string, status: AstParseResult['status'], parser: AstParseResult['parser'], reason: string): AstParseResult {
  return { relativePath, status, parser, observationCount: 0, observations: [], reason }
}

function createFingerprint(relativePath: string, stat: ReaderStat): EvidenceFingerprint | undefined {
  if (stat.size === undefined || !Number.isFinite(stat.size)) return undefined
  if (!stat.version && ![stat.mtimeMs, stat.ctimeMs].every(Number.isFinite)) return undefined
  return { relativePath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs ?? 0, ctimeMs: stat.ctimeMs ?? 0, version: stat.version }
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192))
  if (sample.includes(0)) return true
  let control = 0
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) control += 1
  }
  return sample.length > 0 && control / sample.length > 0.1
}

function summarizeConfig(input: Record<string, unknown>): Record<string, unknown> {
  const keys = ['name', 'version', 'private', 'type', 'main', 'module', 'bin', 'scripts', 'dependencies', 'devDependencies', 'engines']
  return Object.fromEntries(keys.filter((key) => key in input).map((key) => [key, input[key]]))
}

function summarizeLineConfig(text: string): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*[:=]\s*["']?([^"'#]+)["']?\s*$/)
    if (match) values[match[1]] = redactSecretLike(match[2].trim()).text.slice(0, 200)
  }
  return values
}

function errorMessage(error: unknown, provider = false): string {
  if (provider) return 'Harness filesystem operation failed validation or could not complete'
  return redactSecretLike(error instanceof Error ? error.message : String(error)).text.slice(0, 500)
}
