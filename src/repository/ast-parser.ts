import path from 'node:path'
import { createRequire } from 'node:module'
import { redactSecretLike } from '../safety/content-policy.ts'
import type { AstObservation, AstParseResult, AstParser, RepoAtlasConfig } from '../types.ts'

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

interface AstParserOptions {
  signal?: AbortSignal
  maxTokens: number
  maxObservations: number
  maxObservationTextBytes: number
}

interface CompilerNode {
  pos: number
  end: number
  getStart(sourceFile: CompilerSourceFile): number
  getText?(sourceFile?: CompilerSourceFile): string
}

interface CompilerSourceFile extends CompilerNode {
  statements: readonly CompilerNode[]
  getLineAndCharacterOfPosition(position: number): { line: number; character: number }
  parseDiagnostics?: readonly unknown[]
}

type CompilerGuard = (node: CompilerNode) => boolean

interface CompilerApi {
  createSourceFile: (fileName: string, text: string, languageVersion: unknown, setParentNodes: boolean, scriptKind: unknown) => CompilerSourceFile
  ScriptTarget: Record<string, unknown>
  ScriptKind: Record<string, unknown>
  isImportDeclaration: CompilerGuard
  isImportEqualsDeclaration: CompilerGuard
  isExportDeclaration: CompilerGuard
  isExportAssignment: CompilerGuard
  isFunctionDeclaration: CompilerGuard
  isClassDeclaration: CompilerGuard
  isInterfaceDeclaration: CompilerGuard
  isTypeAliasDeclaration: CompilerGuard
  isEnumDeclaration: CompilerGuard
  isVariableStatement: CompilerGuard
  isExpressionStatement: CompilerGuard
  isCallExpression: CompilerGuard
}

interface Token {
  value: string
  kind: 'identifier' | 'string' | 'punctuation'
  position: number
  line: number
  column: number
  staticString?: boolean
}

let cachedCompilerApi: CompilerApi | null | undefined

export function isAstSupportedPath(relativePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())
}

export function parseAstSource(relativePath: string, text: string, options: AstParserOptions): AstParseResult {
  if (!isAstSupportedPath(relativePath)) {
    return result(relativePath, 'not-analyzed', 'unavailable', [], 'v1.3 AST analysis supports only .ts, .tsx, .js, and .jsx files')
  }
  if (options.signal?.aborted) return result(relativePath, 'interrupted', 'unavailable', [], 'user interrupted AST analysis')

  const compilerApi = loadCompilerApi()
  if (compilerApi) {
    try {
      return parseWithCompiler(compilerApi, relativePath, text, options)
    } catch (error) {
      return result(relativePath, 'read-failed', 'typescript-compiler', [], `TypeScript parser failed: ${boundedText(errorMessage(error), options.maxObservationTextBytes)}`)
    }
  }
  return parseWithBoundedStructure(relativePath, text, options)
}

function loadCompilerApi(): CompilerApi | undefined {
  if (cachedCompilerApi !== undefined) return cachedCompilerApi ?? undefined
  try {
    const require = createRequire(import.meta.url)
    cachedCompilerApi = asCompilerApi(require('typescript'))
  } catch {
    cachedCompilerApi = null
  }
  return cachedCompilerApi ?? undefined
}

function asCompilerApi(value: unknown): CompilerApi | undefined {
  if (!isRecord(value)) return undefined
  const functions = [
    'createSourceFile',
    'isImportDeclaration',
    'isImportEqualsDeclaration',
    'isExportDeclaration',
    'isExportAssignment',
    'isFunctionDeclaration',
    'isClassDeclaration',
    'isInterfaceDeclaration',
    'isTypeAliasDeclaration',
    'isEnumDeclaration',
    'isVariableStatement',
    'isExpressionStatement',
    'isCallExpression',
  ]
  if (!functions.every((name) => typeof value[name] === 'function')) return undefined
  if (!isRecord(value.ScriptTarget) || !isRecord(value.ScriptKind)) return undefined
  return value as unknown as CompilerApi
}

function parseWithCompiler(api: CompilerApi, relativePath: string, text: string, options: AstParserOptions): AstParseResult {
  if (text.length > options.maxTokens * 8) {
    return result(relativePath, 'budget-exhausted', 'typescript-compiler', [], 'AST source-size budget exhausted; remaining syntax was not analyzed')
  }
  const scriptKind = api.ScriptKind[path.posix.extname(relativePath).toLowerCase() === '.tsx' ? 'TSX' : path.posix.extname(relativePath).toLowerCase() === '.jsx' ? 'JSX' : path.posix.extname(relativePath).toLowerCase() === '.js' ? 'JS' : 'TS']
  const target = api.ScriptTarget.Latest ?? api.ScriptTarget.ESNext ?? 99
  const sourceFile = api.createSourceFile(relativePath, text, target, false, scriptKind)
  if (sourceFile.parseDiagnostics?.length) {
    return result(relativePath, 'read-failed', 'typescript-compiler', [], `TypeScript parser reported ${sourceFile.parseDiagnostics.length} syntax diagnostic(s)`)
  }
  const observations: AstObservation[] = []
  let bounded = false
  for (const statement of sourceFile.statements) {
    if (options.signal?.aborted) return result(relativePath, 'interrupted', 'typescript-compiler', observations, 'user interrupted AST analysis')
    const additions = compilerObservations(api, sourceFile, statement, options)
    for (const observation of additions) {
      if (observations.length >= options.maxObservations) {
        bounded = true
        break
      }
      observations.push(observation)
    }
    if (bounded) break
  }
  return result(relativePath, bounded ? 'budget-exhausted' : 'syntax-confirmed', 'typescript-compiler', observations, bounded ? 'AST observation limit reached; remaining syntax was not analyzed' : undefined)
}

function compilerObservations(api: CompilerApi, sourceFile: CompilerSourceFile, node: CompilerNode, options: AstParserOptions): AstObservation[] {
  const observations: AstObservation[] = []
  if (api.isImportDeclaration(node) || api.isImportEqualsDeclaration(node)) {
    const moduleSpecifier = stringProperty(property(node, 'moduleSpecifier'), 'text') ?? stringProperty(property(property(node, 'moduleReference'), 'expression'), 'text')
    observations.push(makeCompilerObservation(sourceFile, node, 'import', moduleSpecifier ? `import from ${moduleSpecifier}` : 'import declaration', options, { moduleSpecifier }))
  } else if (api.isExportDeclaration(node) || api.isExportAssignment(node)) {
    const moduleSpecifier = stringProperty(property(node, 'moduleSpecifier'), 'text')
    observations.push(makeCompilerObservation(sourceFile, node, 'export', moduleSpecifier ? `export from ${moduleSpecifier}` : 'export declaration', options, { moduleSpecifier }))
  } else if (api.isFunctionDeclaration(node)) {
    const name = nodeName(node)
    observations.push(makeCompilerObservation(sourceFile, node, 'function', name ? `function ${name}` : 'anonymous function declaration', options, { name }))
  } else if (api.isClassDeclaration(node)) {
    const name = nodeName(node)
    observations.push(makeCompilerObservation(sourceFile, node, 'class', name ? `class ${name}` : 'anonymous class declaration', options, { name }))
  } else if (api.isInterfaceDeclaration(node) || api.isTypeAliasDeclaration(node) || api.isEnumDeclaration(node)) {
    const name = nodeName(node)
    observations.push(makeCompilerObservation(sourceFile, node, 'declaration', name ? `declaration ${name}` : 'top-level declaration', options, { name }))
  } else if (api.isVariableStatement(node)) {
    const declarations = property(node, 'declarationList')
    const items = property(declarations, 'declarations')
    const itemValues: unknown[] = Array.isArray(items) ? items : []
    if (itemValues.length) {
      for (const item of itemValues.slice(0, options.maxObservations)) {
        if (!isCompilerNode(item)) continue
        const name = nodeName(item)
        observations.push(makeCompilerObservation(sourceFile, item, 'variable', name ? `variable ${name}` : 'top-level variable', options, { name }))
      }
    }
  } else if (api.isExpressionStatement(node)) {
    const expression = property(node, 'expression')
    if (isCompilerNode(expression) && api.isCallExpression(expression)) {
      const text = expression.getText?.(sourceFile) ?? ''
      const call = text.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/)?.[1]
      if (call && /(?:route|router|app|server|use|get|post|put|delete|listen)/i.test(call)) {
        observations.push(makeCompilerObservation(sourceFile, expression, 'call', `call ${call}()`, options))
      }
    }
  }
  return observations
}

function makeCompilerObservation(sourceFile: CompilerSourceFile, node: CompilerNode, kind: AstObservation['kind'], summary: string, options: AstParserOptions, extra: Pick<AstObservation, 'name' | 'moduleSpecifier'> = {}): AstObservation {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    kind,
    line: location.line + 1,
    column: location.character + 1,
    summary: boundedText(summary, options.maxObservationTextBytes),
    ...extra,
    ...(extra.moduleSpecifier !== undefined ? boundedModuleSpecifier(extra.moduleSpecifier) : {}),
  }
}

function parseWithBoundedStructure(relativePath: string, text: string, options: AstParserOptions): AstParseResult {
  const tokenized = tokenize(text, options.maxTokens, options.signal)
  if (tokenized.status !== 'ok') return result(relativePath, tokenized.status, 'bounded-structural', [], tokenized.reason)
  const balance = validateBalance(tokenized.tokens)
  if (balance) return result(relativePath, 'read-failed', 'bounded-structural', [], balance)

  const observations: AstObservation[] = []
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  let bounded = false
  const add = (observation: AstObservation): void => {
    if (observations.length >= options.maxObservations) bounded = true
    else observations.push(observation)
  }
  for (let index = 0; index < tokenized.tokens.length; index += 1) {
    const token = tokenized.tokens[index]
    if (options.signal?.aborted) return result(relativePath, 'interrupted', 'bounded-structural', observations, 'user interrupted AST analysis')
    const topLevel = braceDepth === 0 && parenDepth === 0 && bracketDepth === 0
    if (topLevel && token.kind === 'identifier') {
      if (token.value === 'import' && tokenized.tokens[index + 1]?.value !== '(' && tokenized.tokens[index + 1]?.value !== '.') {
        const moduleToken = findModuleSpecifier(tokenized.tokens, index)
        add(observation(token, 'import', moduleToken ? `import from ${moduleToken.value}` : 'import declaration', options, moduleToken ? boundedModuleSpecifier(moduleToken.value, moduleToken.staticString === true) : {}))
      } else if (token.value === 'export') {
        const moduleToken = findModuleSpecifier(tokenized.tokens, index)
        add(observation(token, 'export', moduleToken ? `export from ${moduleToken.value}` : 'export declaration', options, moduleToken ? boundedModuleSpecifier(moduleToken.value, moduleToken.staticString === true) : {}))
      } else if (['function', 'class', 'interface', 'type', 'enum'].includes(token.value)) {
        const name = nextIdentifier(tokenized.tokens, index + 1)
        const kind = token.value === 'function' ? 'function' : token.value === 'class' ? 'class' : 'declaration'
        add(observation(token, kind, name ? `${token.value} ${name}` : `${token.value} declaration`, options, { name }))
      } else if (['const', 'let', 'var'].includes(token.value)) {
        const name = nextIdentifier(tokenized.tokens, index + 1)
        add(observation(token, 'variable', name ? `variable ${name}` : 'top-level variable', options, { name }))
      } else if (token.kind === 'identifier' && tokenized.tokens[index + 1]?.value === '.' && tokenized.tokens[index + 2]?.kind === 'identifier' && tokenized.tokens[index + 3]?.value === '(') {
        const call = `${token.value}.${tokenized.tokens[index + 2].value}`
        if (/(?:route|router|app|server|use|get|post|put|delete|listen)/i.test(call)) add(observation(token, 'call', `call ${call}()`, options))
      }
    }
    if (token.value === '{') braceDepth += 1
    else if (token.value === '}') braceDepth -= 1
    else if (token.value === '(') parenDepth += 1
    else if (token.value === ')') parenDepth -= 1
    else if (token.value === '[') bracketDepth += 1
    else if (token.value === ']') bracketDepth -= 1
    if (bounded) break
  }
  return result(relativePath, bounded ? 'budget-exhausted' : 'syntax-confirmed', 'bounded-structural', observations, bounded ? 'AST observation limit reached; remaining syntax was not analyzed' : undefined)
}

function tokenize(text: string, maxTokens: number, signal?: AbortSignal): { status: 'ok' | 'budget-exhausted' | 'interrupted' | 'read-failed'; tokens: Token[]; reason?: string } {
  const tokens: Token[] = []
  let index = 0
  let line = 1
  let column = 1
  while (index < text.length) {
    if (signal?.aborted) return { status: 'interrupted', tokens, reason: 'user interrupted AST analysis' }
    const current = text[index]
    if (/\s/.test(current)) {
      if (current === '\n') { line += 1; column = 1 } else column += 1
      index += 1
      continue
    }
    if (current === '/' && text[index + 1] === '/') {
      index += 2
      column += 2
      while (index < text.length && text[index] !== '\n') { index += 1; column += 1 }
      continue
    }
    if (current === '/' && text[index + 1] === '*') {
      const startLine = line
      const startColumn = column
      index += 2
      column += 2
      let closed = false
      while (index < text.length) {
        if (text[index] === '*' && text[index + 1] === '/') { index += 2; column += 2; closed = true; break }
        if (text[index] === '\n') { line += 1; column = 1; index += 1 } else { index += 1; column += 1 }
      }
      if (!closed) return { status: 'read-failed', tokens, reason: `unterminated comment at ${startLine}:${startColumn}` }
      continue
    }
    const tokenLine = line
    const tokenColumn = column
    const position = index
    if (current === '\'' || current === '"' || current === '`') {
      const quote = current
      index += 1
      column += 1
      let value = ''
      let closed = false
      let staticString = quote !== '`'
      while (index < text.length) {
        const char = text[index]
        if (char === '\\') {
          staticString = false // Do not implement a partial JavaScript escape decoder.
          value += char + (text[index + 1] ?? '')
          index += 2
          column += 2
          continue
        }
        if (char === quote) { index += 1; column += 1; closed = true; break }
        if (char === '\n') { staticString = false; line += 1; column = 1; value += char; index += 1; continue }
        value += char
        index += 1
        column += 1
      }
      if (!closed) return { status: 'read-failed', tokens, reason: `unterminated string at ${tokenLine}:${tokenColumn}` }
      tokens.push({ value, kind: 'string', position, line: tokenLine, column: tokenColumn, staticString })
    } else if (/[A-Za-z_$]/.test(current)) {
      let value = current
      index += 1
      column += 1
      while (index < text.length && /[A-Za-z0-9_$]/.test(text[index])) { value += text[index]; index += 1; column += 1 }
      tokens.push({ value, kind: 'identifier', position, line: tokenLine, column: tokenColumn })
    } else {
      const value = text.slice(index, index + 2) === '=>' || text.slice(index, index + 2) === '?.' ? text.slice(index, index + 2) : current
      index += value.length
      column += value.length
      tokens.push({ value, kind: 'punctuation', position, line: tokenLine, column: tokenColumn })
    }
    if (tokens.length > maxTokens) return { status: 'budget-exhausted', tokens: tokens.slice(0, maxTokens), reason: 'AST token budget exhausted; remaining syntax was not analyzed' }
  }
  return { status: 'ok', tokens }
}

function validateBalance(tokens: readonly Token[]): string | undefined {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' }
  const stack: string[] = []
  for (const token of tokens) {
    if (pairs[token.value]) stack.push(pairs[token.value])
    else if (Object.values(pairs).includes(token.value)) {
      if (stack.pop() !== token.value) return `unbalanced syntax near ${token.line}:${token.column}`
    }
  }
  return stack.length ? 'unbalanced syntax at end of file' : undefined
}

function findModuleSpecifier(tokens: readonly Token[], start: number): Token | undefined {
  const first = tokens[start + 1]
  if (tokens[start].value === 'import' && first?.kind === 'string') return first
  // A declaration initializer is not a re-export, even if it contains a path.
  if (tokens[start].value === 'export' && !['*', '{', 'type'].includes(first?.value)) return undefined
  for (let index = start + 1; index < Math.min(tokens.length - 1, start + 80); index += 1) {
    const token = tokens[index]
    if ([';', '=', 'const', 'let', 'var', 'function', 'class', 'import', 'export'].includes(token.value)) break
    if (token.value === 'from' && tokens[index + 1].kind === 'string') return tokens[index + 1]
  }
  return undefined
}

function nextIdentifier(tokens: readonly Token[], start: number): string | undefined {
  for (let index = start; index < Math.min(tokens.length, start + 8); index += 1) {
    if (tokens[index].kind === 'identifier' && !['from', 'as', 'extends', 'implements'].includes(tokens[index].value)) return boundedText(tokens[index].value, 80)
    if ([';', '{', '(', '='].includes(tokens[index].value)) break
  }
  return undefined
}

function observation(token: Token, kind: AstObservation['kind'], summary: string, options: AstParserOptions, extra: Pick<AstObservation, 'name' | 'moduleSpecifier'> = {}): AstObservation {
  return { kind, line: token.line, column: token.column, summary: boundedText(summary, options.maxObservationTextBytes), ...extra }
}

function result(relativePath: string, status: AstParseResult['status'], parser: AstParser, observations: AstObservation[], reason?: string): AstParseResult {
  return { relativePath, status, parser, observationCount: observations.length, observations, reason }
}

function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function stringProperty(value: unknown, key: string): string | undefined {
  const candidate = property(value, key)
  return typeof candidate === 'string' ? candidate : undefined
}

function nodeName(node: CompilerNode): string | undefined {
  const name = property(node, 'name')
  if (isRecord(name) && typeof name.text === 'string') return boundedText(name.text, 80)
  return undefined
}

function isCompilerNode(value: unknown): value is CompilerNode {
  return isRecord(value) && typeof value.pos === 'number' && typeof value.end === 'number' && typeof value.getStart === 'function'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function boundedModuleSpecifier(value: string, reliable = true): Pick<AstObservation, 'moduleSpecifier' | 'moduleSpecifierExact'> {
  // Keep the existing 160 UTF-16 code-unit limit; display formatting is not identity.
  const redacted = redactSecretLike(value)
  const exact = reliable && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) &&
    !value.includes('[REDACTED_SECRET]') && redacted.text === value
  return { moduleSpecifier: exact ? value : boundedText(value, 160), moduleSpecifierExact: exact }
}

function boundedText(value: string, maxBytes: number): string {
  const text = redactSecretLike(value.replaceAll(/\s+/g, ' ').trim()).text
  return text.slice(0, maxBytes)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
