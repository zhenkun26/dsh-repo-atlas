import path from 'node:path'
import type { ControlledActionRecipe, ControlledActionsConfig, RepoAtlasConfig } from './types.ts'

export const DEFAULT_EXCLUDE_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.codex',
  '.dsh',
  '.pnpm-store',
  '.venv',
  'venv',
]

export const DEFAULT_SENSITIVE_FILE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'credentials.*',
  '*credentials*',
  '*secret*',
]

export const DEFAULT_CONFIG: Omit<RepoAtlasConfig, 'workspaceRoot'> = {
  excludeDirs: DEFAULT_EXCLUDE_DIRS,
  sensitiveFilePatterns: DEFAULT_SENSITIVE_FILE_PATTERNS,
  maxCandidateFiles: 5_000,
  maxFileBytes: 1 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxActions: 60,
  maxAstFiles: 64,
  maxAstTokensPerFile: 12_000,
  maxAstObservationsPerFile: 100,
  maxAstObservationTextBytes: 240,
  cacheValidation: 'metadata',
  respectGitIgnore: true,
  controlledActions: {
    enabled: false,
    recipes: [],
  },
}

export function createConfig(workspaceRoot: string, overrides: Partial<Omit<RepoAtlasConfig, 'workspaceRoot'>> = {}): RepoAtlasConfig {
  if (overrides.cacheValidation !== undefined && !['metadata', 'content'].includes(overrides.cacheValidation)) throw new Error('cacheValidation must be metadata or content')
  if (overrides.respectGitIgnore !== undefined && typeof overrides.respectGitIgnore !== 'boolean') throw new Error('respectGitIgnore must be boolean')
  return {
    workspaceRoot: path.resolve(workspaceRoot),
    scope: overrides.scope?.length ? [...overrides.scope] : undefined,
    excludeDirs: [...(overrides.excludeDirs ?? DEFAULT_CONFIG.excludeDirs)],
    sensitiveFilePatterns: [...(overrides.sensitiveFilePatterns ?? DEFAULT_CONFIG.sensitiveFilePatterns)],
    maxCandidateFiles: positiveInteger(overrides.maxCandidateFiles ?? DEFAULT_CONFIG.maxCandidateFiles, 'maxCandidateFiles'),
    maxFileBytes: positiveInteger(overrides.maxFileBytes ?? DEFAULT_CONFIG.maxFileBytes, 'maxFileBytes'),
    maxTotalBytes: positiveInteger(overrides.maxTotalBytes ?? DEFAULT_CONFIG.maxTotalBytes, 'maxTotalBytes'),
    maxActions: positiveInteger(overrides.maxActions ?? DEFAULT_CONFIG.maxActions, 'maxActions'),
    maxAstFiles: positiveInteger(overrides.maxAstFiles ?? DEFAULT_CONFIG.maxAstFiles, 'maxAstFiles'),
    maxAstTokensPerFile: positiveInteger(overrides.maxAstTokensPerFile ?? DEFAULT_CONFIG.maxAstTokensPerFile, 'maxAstTokensPerFile'),
    maxAstObservationsPerFile: positiveInteger(overrides.maxAstObservationsPerFile ?? DEFAULT_CONFIG.maxAstObservationsPerFile, 'maxAstObservationsPerFile'),
    maxAstObservationTextBytes: positiveInteger(overrides.maxAstObservationTextBytes ?? DEFAULT_CONFIG.maxAstObservationTextBytes, 'maxAstObservationTextBytes'),
    cacheValidation: overrides.cacheValidation ?? DEFAULT_CONFIG.cacheValidation,
    respectGitIgnore: overrides.respectGitIgnore ?? DEFAULT_CONFIG.respectGitIgnore,
    controlledActions: normalizeControlledActions(overrides.controlledActions ?? DEFAULT_CONFIG.controlledActions),
  }
}

function normalizeControlledActions(value: ControlledActionsConfig): ControlledActionsConfig {
  return {
    enabled: value.enabled === true,
    recipes: value.recipes.map((recipe) => normalizeRecipe(recipe)),
  }
}

function normalizeRecipe(recipe: ControlledActionRecipe): ControlledActionRecipe {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe.id)) throw new Error('controlled action recipe id must be kebab-case')
  if (!recipe.command.trim() || /\s/.test(recipe.command) || recipe.command.includes('/') || recipe.command.includes('\\')) {
    throw new Error(`controlled action recipe ${recipe.id} must use a bare executable name`)
  }
  if (isShellCommand(recipe.command, recipe.args)) throw new Error(`controlled action recipe ${recipe.id} cannot invoke a shell`)
  if (!Number.isSafeInteger(recipe.timeoutMs) || recipe.timeoutMs <= 0) throw new Error(`controlled action recipe ${recipe.id} timeoutMs must be a positive safe integer`)
  if (!Number.isSafeInteger(recipe.maxOutputBytes) || recipe.maxOutputBytes <= 0) throw new Error(`controlled action recipe ${recipe.id} maxOutputBytes must be a positive safe integer`)
  return { ...recipe, args: [...recipe.args] }
}

function isShellCommand(command: string, args: string[]): boolean {
  if (['sh', 'bash', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd'].includes(command.toLowerCase())) return true
  return args.some((arg) => ['-c', '-command', '/c', '/command'].includes(arg.toLowerCase()))
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}
