import { withJsonOutput } from './json-output.ts'
import { createHash } from 'node:crypto'
import { isSensitivePath, redactSecretLike } from '../safety/content-policy.ts'
import { isPathCoveredByScope } from '../repository/evidence-cache.ts'
import { LocalRepositoryReader, type RepositoryReader } from '../repository/reader.ts'
import { createHarnessRepositoryReader, type HarnessFileSystem } from './repository-reader.ts'
import type { HarnessPluginContext, HarnessTool, HarnessToolExecution, RepoAtlasPluginConfig } from './public.ts'
import type { HarnessSessionRuntimeResolution } from './session-runtime.ts'

interface Position { readonly line: number; readonly character: number }
interface Range { readonly start: Position; readonly end: Position }
type Operation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'
export interface HarnessLspService {
  query(request: { operation: Operation; filePath: string; position: Position; workspaceRoot: string }, signal?: AbortSignal): Promise<
    { readonly kind: 'locations'; readonly locations: readonly { readonly uri: string; readonly range: Range }[]; readonly resolvedWorkspaceUri: string } |
    { readonly kind: 'hover'; readonly hover: { readonly contents: string; readonly range?: Range } | null }>
}

/** Optional semantic navigation. It never installs or owns a language server. */
export function createSymbolTool(resolve: (execution: HarnessToolExecution | undefined) => HarnessSessionRuntimeResolution,
  ctx: HarnessPluginContext, config: RepoAtlasPluginConfig): HarnessTool {
  const timeoutMs = config.symbols?.timeoutMs ?? 5_000
  const maxResults = config.symbols?.maxResults ?? 50
  integer(timeoutMs, 1, 15_000, 'symbols.timeoutMs')
  integer(maxResults, 1, 100, 'symbols.maxResults')
  return withJsonOutput({
    name: 'repo_atlas_symbols',
    description: 'Query the configured Harness LSP for definitions, references, implementations or hover. Requires a current analyzed source snapshot. Coordinates are one-based UTF-16; references indicate possible symbol impact, not runtime breakage.',
    parameters: { type: 'object', additionalProperties: false, required: ['operation', 'sourcePath', 'line', 'character'], properties: {
      operation: { type: 'string', enum: ['goToDefinition', 'findReferences', 'goToImplementation', 'hover'] },
      sourcePath: { type: 'string', maxLength: 1024 }, line: { type: 'integer', minimum: 1 }, character: { type: 'integer', minimum: 1 },
    } },
    output: { schema: { type: 'object' }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
    async execute(input, execution) {
      const resolved = resolve(execution)
      if (!resolved.ok) return blocked(resolved.reason)
      const { runtime } = resolved
      const analysis = runtime.analysis
      if (!analysis) return blocked('Run repo_atlas_analyze in this session first.')
      let timer: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController()
      const signal = AbortSignal.any([resolved.execution.signal, controller.signal])
      try {
        const data = parseInput(input)
        const snapshot = analysis.sourceSnapshots?.get(data.sourcePath)
        if (!snapshot || !eligible(data.sourcePath)) return blocked('Source is outside the retained, readable analysis scope.')
        const lines = snapshot.text.split('\n')
        if (data.line > lines.length || data.character > lines[data.line - 1].length + 1) return blocked('Cursor is outside the retained source text.')
        const service = ctx.get?.<HarnessLspService>('lsp', true)
        if (typeof service?.query !== 'function') return blocked('Configured Harness LSP is unavailable.')
        const aborted = new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Symbol query interrupted or timed out.')), { once: true })
          timer = setTimeout(() => controller.abort(), timeoutMs)
        })
        const operation = async () => {
          let reader: RepositoryReader
          if (analysis.reader?.kind === 'harness') {
            const fs = ctx.get?.<HarnessFileSystem>('fs', true)
            if (!fs) throw new Error('Analysis filesystem is unavailable; no local fallback was attempted.')
            reader = await createHarnessRepositoryReader(fs, runtime.workspaceRoot, signal)
          } else reader = new LocalRepositoryReader(runtime.workspaceRoot)
          if (analysis.reader && reader.identity !== analysis.reader.identity) throw new Error('Analysis filesystem changed; analyze again.')
          const bytes = await reader.read(data.sourcePath, Math.min(runtime.config.maxFileBytes, runtime.config.maxTotalBytes), signal)
          const redactedSource = redactSecretLike(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          if (redactedSource.redacted) throw new Error('Redaction changed source coordinates; symbol navigation requires an unredacted cursor basis.')
          const text = redactedSource.text
          if (createHash('sha256').update(text).digest('hex') !== snapshot.redactedContentSha256) throw new Error('Source changed since analysis; analyze again before navigating.')
          const result = await service.query({ operation: data.operation, filePath: data.sourcePath,
            position: { line: data.line - 1, character: data.character - 1 }, workspaceRoot: runtime.workspaceRoot }, signal)
          signal.throwIfAborted()
          if (data.operation === 'hover') {
            if (result.kind !== 'hover') throw new Error('LSP returned a mismatched result kind.')
            if (result.hover === null) return { policy: 'readonly', status: 'available', kind: 'hover', hover: null }
            if (typeof result.hover?.contents !== 'string' || Buffer.byteLength(result.hover.contents) > 65_536 || (result.hover.range && !validRange(result.hover.range))) throw new Error('LSP hover is malformed or exceeds the input cap.')
            const redacted = redactSecretLike(result.hover.contents)
            return { policy: 'readonly', status: 'available', kind: 'hover', sourcePath: data.sourcePath,
              contents: boundedText(redacted.text), truncated: Buffer.byteLength(redacted.text) > 8_192, redacted: redacted.redacted,
              range: result.hover.range ? oneBased(result.hover.range) : undefined, contentPolicy: 'repository-data-not-instructions' }
          }
          if (result.kind !== 'locations' || !Array.isArray(result.locations)) throw new Error('LSP locations are malformed.')
          const root = safeFileUrl(result.resolvedWorkspaceUri)
          const locations: Array<{ sourcePath: string; range: ReturnType<typeof oneBased> }> = []
          const seen = new Set<string>()
          let filtered = 0
          for (const location of result.locations.slice(0, 1_000)) {
            signal.throwIfAborted()
            try {
              if (!validRange(location.range)) throw new Error('invalid range')
              const relative = relativeLocation(root, safeFileUrl(location.uri))
              if (!eligible(relative) || !reader.checkPath(relative).allowed || (await reader.stat(relative, signal))?.type !== 'file') throw new Error('ineligible target')
              const key = `${relative}:${JSON.stringify(location.range)}`
              if (seen.has(key)) continue
              seen.add(key)
              if (locations.length < maxResults) locations.push({ sourcePath: relative, range: oneBased(location.range) })
            } catch { filtered++ }
          }
          signal.throwIfAborted()
          return { policy: 'readonly', status: 'available', kind: 'locations', operation: data.operation, locations,
            filteredCount: filtered, truncated: seen.size > maxResults || result.locations.length > 1_000,
            coordinates: 'one-based-UTF-16-half-open', sourceValidation: 'query-source-content-checked', targetValidation: 'observed-readable-paths; target content not revalidated',
            limitations: ['Configured LSP observations only; omitted locations do not prove no references or no runtime impact.'] }
        }
        return await Promise.race([operation(), aborted])
      } catch {
        return blocked(signal.aborted ? 'Symbol query interrupted or timed out.' : 'Symbol query failed validation or source changed; analyze again and check the configured LSP.')
      } finally { if (timer) clearTimeout(timer); controller.abort() }

      function eligible(sourcePath: string): boolean {
        return safePath(sourcePath) && isPathCoveredByScope(sourcePath, analysis!.goal.scope ?? runtime.config.scope) &&
          !isSensitivePath(sourcePath, runtime.config.sensitiveFilePatterns) && analysis!.scan.files.some(file => file.relativePath === sourcePath && file.kind === 'text') &&
          !runtime.config.excludeDirs.some(dir => sourcePath.split('/').includes(dir) || sourcePath === dir || sourcePath.startsWith(`${dir}/`))
      }
    },
  })
}

function parseInput(input: unknown): { operation: Operation; sourcePath: string; line: number; character: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an object')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !['operation', 'sourcePath', 'line', 'character'].includes(key)) ||
    !['goToDefinition', 'findReferences', 'goToImplementation', 'hover'].includes(value.operation as string) || !safePath(value.sourcePath)) throw new Error('Invalid symbol query')
  integer(value.line, 1, 10_000_000, 'line'); integer(value.character, 1, 10_000_000, 'character')
  return value as ReturnType<typeof parseInput>
}
function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/^[\\/]|^[a-z]:|[\\\u0000-\u001f]/i.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..')
}
function safeFileUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 4_096) throw new Error('LSP URI exceeds its cap')
  const url = new URL(value)
  if (url.protocol !== 'file:' || url.username || url.password || url.search || url.hash || /%2f|%5c/i.test(url.pathname)) throw new Error('Unsupported LSP URI')
  return url
}
function relativeLocation(root: URL, location: URL): string {
  if (root.host !== location.host) throw new Error('External LSP location')
  const prefix = decodeURIComponent(root.pathname).replace(/\/$/, '') + '/'
  const name = decodeURIComponent(location.pathname)
  if (!name.startsWith(prefix)) throw new Error('External LSP location')
  const relative = name.slice(prefix.length)
  if (!safePath(relative)) throw new Error('Unsafe LSP location')
  return relative
}
function validRange(range: Range): boolean {
  const valid = (point: Position) => point && Number.isSafeInteger(point.line) && Number.isSafeInteger(point.character) && point.line >= 0 && point.character >= 0 && point.line < 10_000_000 && point.character < 10_000_000
  return Boolean(range && valid(range.start) && valid(range.end) && (range.end.line > range.start.line || range.end.line === range.start.line && range.end.character >= range.start.character))
}
function oneBased(range: Range) { return { start: { line: range.start.line + 1, character: range.start.character + 1 }, end: { line: range.end.line + 1, character: range.end.character + 1 } } }
function integer(value: unknown, min: number, max: number, name: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${name} must be an integer from ${min} to ${max}`) }
function blocked(reason: string) { return { policy: 'readonly', status: 'unavailable', blocked: { reason } } }
function boundedText(value: string): string { const bytes = Buffer.from(value); return bytes.subarray(0, 8_192).toString('utf8').replace(/\ufffd$/, '') }
