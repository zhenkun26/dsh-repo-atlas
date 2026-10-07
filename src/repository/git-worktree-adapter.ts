import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { isWithin } from '../safety/path-policy.ts'
import type { GitWorktreeAdapter } from './change-proposal.ts'
import type { ChangeProposalWorktree } from '../types.ts'
import { PatchApplicationError, CommitOperationError, LandingOperationError, LandingInspectionError } from './change-proposal-errors.ts'
import { isSafeGitRevision, isUncertainGitFailure, uniquePaths, isSafeRepositoryRelativePath, samePathSet, redactError } from './change-proposal-format.ts'

const execFileAsync = promisify(execFile)

export function createNodeGitWorktreeAdapter(): GitWorktreeAdapter {
  return {
    async discover(workspaceRoot, signal) {
      const resolvedWorkspace = await fs.realpath(path.resolve(workspaceRoot))
      const repositoryRoot = path.resolve(await runGit(['-C', resolvedWorkspace, 'rev-parse', '--show-toplevel'], resolvedWorkspace, signal))
      const baseRevision = await runGit(['-C', repositoryRoot, 'rev-parse', '--verify', 'HEAD^{commit}'], repositoryRoot, signal)
      return { repositoryRoot, baseRevision }
    },
    async create(repositoryRoot, baseRevision, signal) {
      const target = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-atlas-proposal-'))
      try {
        await runGit(['-C', repositoryRoot, 'worktree', 'add', '--detach', target, baseRevision], repositoryRoot, signal)
        const canonicalTarget = await fs.realpath(target)
        const worktree: ChangeProposalWorktree = {
          path: canonicalTarget,
          baseRevision,
          identity: worktreeIdentity(canonicalTarget),
        }
        const inspected = await this.inspect(repositoryRoot, worktree, signal)
        if (inspected.identity !== worktree.identity) throw new Error('created worktree identity could not be verified')
        return worktree
      } catch (error) {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    },
    async inspect(repositoryRoot, worktree, signal) {
      const listing = await runGit(['-C', repositoryRoot, 'worktree', 'list', '--porcelain'], repositoryRoot, signal)
      const canonicalTarget = await fs.realpath(worktree.path)
      const record = parseWorktreeListing(listing, canonicalTarget)
      if (!record) throw new Error('managed worktree is not present at the expected path')
      const status = await runGit(['-C', worktree.path, 'status', '--porcelain', '--untracked-files=all'], worktree.path, signal)
      const trackedChanges = await runGit(['-C', worktree.path, 'diff', '--name-only', '--no-ext-diff'], worktree.path, signal)
      const stagedChanges = await runGit(['-C', worktree.path, 'diff', '--cached', '--name-only', '--no-ext-diff'], worktree.path, signal)
      const untrackedChanges = await runGit(['-C', worktree.path, 'ls-files', '--others', '--exclude-standard'], worktree.path, signal)
      return {
        path: canonicalTarget,
        identity: worktreeIdentity(canonicalTarget),
        baseRevision: record.baseRevision,
        dirty: status.length > 0,
        changedPaths: uniquePaths([...trackedChanges.split('\n'), ...stagedChanges.split('\n'), ...untrackedChanges.split('\n')]),
      }
    },
    async inspectSource(repositoryRoot, sourceWorkspaceRoot, signal) {
      const canonicalWorkspace = await fs.realpath(path.resolve(sourceWorkspaceRoot))
      const discoveredRoot = path.resolve(await runGit(['-C', canonicalWorkspace, 'rev-parse', '--show-toplevel'], canonicalWorkspace, signal))
      if (path.resolve(repositoryRoot) !== discoveredRoot) throw new Error('source workspace repository root does not match the proposal repository')
      const revision = await runGit(['-C', canonicalWorkspace, 'rev-parse', '--verify', 'HEAD^{commit}'], canonicalWorkspace, signal)
      const status = await runGit(['-C', canonicalWorkspace, 'status', '--porcelain', '--untracked-files=all'], canonicalWorkspace, signal)
      return { path: canonicalWorkspace, repositoryRoot: discoveredRoot, revision, dirty: status.length > 0 }
    },
    async inspectLanding(repositoryRoot, sourceWorkspaceRoot, expectedSourceRevision, commitRevision, signal) {
      if (!isSafeGitRevision(expectedSourceRevision) || !isSafeGitRevision(commitRevision)) throw new LandingInspectionError('source or target revision is not a safe Git revision')
      const source = await this.inspectSource(repositoryRoot, sourceWorkspaceRoot, signal)
      let targetRevision: string
      try {
        targetRevision = await runGit(['-C', source.path, 'rev-parse', '--verify', `${commitRevision}^{commit}`], source.path, signal)
        if (targetRevision !== commitRevision) throw new Error('target commit revision could not be resolved exactly')
      } catch (error) {
        throw new LandingInspectionError(`target commit is not locally resolvable: ${redactError(error)}`, true)
      }
      try {
        const sourceIsAncestor = await isGitAncestor(source.path, source.revision, targetRevision, signal)
        const targetIsAncestor = await isGitAncestor(source.path, targetRevision, source.revision, signal)
        return { source, targetRevision, sourceIsAncestor, targetIsAncestor }
      } catch (error) {
        throw new LandingInspectionError(`local commit ancestry could not be inspected: ${redactError(error)}`)
      }
    },
    async applyPatch(_repositoryRoot, worktree, patchText, workspaceRelativeRoot, signal) {
      const patchCwd = path.resolve(worktree.path, workspaceRelativeRoot || '.')
      if (!isWithin(worktree.path, patchCwd)) throw new Error('patch working directory is outside the managed worktree')
      await runGitWithInput(['-C', patchCwd, 'apply', '--check', '--whitespace=error'], patchCwd, patchText, signal)
      try {
        await runGitWithInput(['-C', patchCwd, 'apply', '--whitespace=error'], patchCwd, patchText, signal)
      } catch (error) {
        throw new PatchApplicationError(redactError(error), true)
      }
    },
    async commit(_repositoryRoot, worktree, repositoryRelativePaths, commitMessage, signal) {
      const paths = uniquePaths(repositoryRelativePaths)
      if (paths.length === 0 || paths.some((value) => !isSafeRepositoryRelativePath(value))) {
        throw new CommitOperationError('commit paths are empty or outside the repository', false)
      }
      try {
        await runGit(['-C', worktree.path, 'add', '--', ...paths], worktree.path, signal)
        const staged = uniquePaths((await runGit(['-C', worktree.path, 'diff', '--cached', '--name-only', '--no-ext-diff'], worktree.path, signal)).split('\n'))
        if (!samePathSet(staged, paths)) throw new Error('staged path set does not exactly match the declared commit paths')
      } catch (error) {
        throw new CommitOperationError(`commit staging failed: ${redactError(error)}`, false)
      }
      try {
        await runGit(['-C', worktree.path, '-c', 'commit.gpgSign=false', 'commit', '--no-verify', '--no-gpg-sign', '-m', commitMessage], worktree.path, signal)
        return await runGit(['-C', worktree.path, 'rev-parse', '--verify', 'HEAD^{commit}'], worktree.path, signal)
      } catch (error) {
        throw new CommitOperationError(`local commit result is unknown: ${redactError(error)}`, true)
      }
    },
    async land(repositoryRoot, sourceWorkspaceRoot, expectedSourceRevision, commitRevision, signal) {
      if (!isSafeGitRevision(expectedSourceRevision) || !isSafeGitRevision(commitRevision)) throw new LandingOperationError('source or target revision is not a safe Git revision', false)
      let inspected: Awaited<ReturnType<GitWorktreeAdapter['inspectSource']>>
      try {
        inspected = await this.inspectSource(repositoryRoot, sourceWorkspaceRoot, signal)
      } catch (error) {
        throw new LandingOperationError(`source landing precondition inspection failed: ${redactError(error)}`, false)
      }
      if (inspected.revision !== expectedSourceRevision || inspected.dirty) throw new LandingOperationError('source workspace is not clean at the expected base revision', false)
      try {
        const resolvedTarget = await runGit(['-C', inspected.path, 'rev-parse', '--verify', `${commitRevision}^{commit}`], inspected.path, signal)
        if (resolvedTarget !== commitRevision) throw new Error('target commit revision could not be resolved exactly')
      } catch (error) {
        throw new LandingOperationError(`target commit is not locally resolvable: ${redactError(error)}`, false)
      }
      try {
        await runGit(['-C', inspected.path, 'merge', '--ff-only', '--no-verify', '--no-edit', commitRevision], inspected.path, signal)
      } catch (error) {
        throw new LandingOperationError(`source fast-forward landing failed: ${redactError(error)}`, isUncertainGitFailure(error, signal))
      }
      try {
        return await runGit(['-C', inspected.path, 'rev-parse', '--verify', 'HEAD^{commit}'], inspected.path, signal)
      } catch (error) {
        throw new LandingOperationError(`source landing result is unknown: ${redactError(error)}`, true)
      }
    },
    async remove(repositoryRoot, worktree, signal) {
      await runGit(['-C', repositoryRoot, 'worktree', 'remove', worktree.path], repositoryRoot, signal)
    },
  }
}

function worktreeIdentity(worktreePath: string): string {
  return createHash('sha256').update(path.resolve(worktreePath)).digest('hex').slice(0, 32)
}

function parseWorktreeListing(listing: string, targetPath: string): { path: string; baseRevision: string } | undefined {
  const blocks = listing.split(/\n(?=worktree )/).map((block) => block.split('\n'))
  for (const lines of blocks) {
    const worktreePath = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    const baseRevision = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length)
    if (worktreePath && baseRevision && path.resolve(worktreePath) === path.resolve(targetPath)) return { path: worktreePath, baseRevision }
  }
  return undefined
}

async function runGit(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd,
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 128 * 1024,
    signal,
  })
  return result.stdout.trim()
}

async function isGitAncestor(cwd: string, ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', cwd, 'merge-base', '--is-ancestor', ancestor, descendant], {
      cwd,
      shell: false,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 128 * 1024,
      signal,
    })
    return true
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
    if (code === 1) return false
    throw error
  }
}

function runGitWithInput(args: readonly string[], cwd: string, input: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Git operation was interrupted'))
      return
    }
    const child = spawn('git', [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => {
      child.kill('SIGTERM')
      finish(() => reject(new Error('Git operation was interrupted')))
    }
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(() => reject(new Error('Git operation timed out')))
    }, 15_000)
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
      if (Buffer.byteLength(stdout) > 128 * 1024) {
        child.kill('SIGTERM')
        finish(() => reject(new Error('Git output exceeded the bounded limit')))
      }
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
      if (Buffer.byteLength(stderr) > 128 * 1024) {
        child.kill('SIGTERM')
        finish(() => reject(new Error('Git error output exceeded the bounded limit')))
      }
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code, signalName) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout.trim())
          return
        }
        reject(new Error(stderr.trim() || `Git exited with ${signalName ?? `code ${code ?? 'unknown'}`}`))
      })
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdin.end(input)
  })
}
