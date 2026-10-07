import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { buildArtifact, filesUnder } from './build-artifact.mjs'

const repoRoot = resolve(process.cwd())
const packageFile = join(repoRoot, 'package.json')
const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
const bundlePatch = readFileSync(join(repoRoot, 'cordis.patch.yml'), 'utf8')
let tempRoot

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function run(executable, args, options = {}) {
  try {
    return execFileSync(executable, args, {
      cwd: repoRoot, encoding: 'utf8', shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000, ...options,
    })
  } catch (error) {
    const detail = error && typeof error === 'object'
      ? [error.stdout, error.stderr].filter(Boolean).join('\n').trim().slice(0, 2_000)
      : ''
    throw new Error(`${executable} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
}

try {
  assertCondition(manifest.name === 'dsh-repo-atlas', 'package name must use the dsh-repo-atlas public identity')
  assertCondition(manifest.private === true, 'package.json must remain private')
  assertCondition(manifest.license === 'MIT', 'package.json must declare the MIT license')
  assertCondition(bundlePatch.includes('id: dsh-repo-atlas') && bundlePatch.includes('name: dsh-repo-atlas/harness'), 'bundle patch must use the dsh-repo-atlas identity')
  assertCondition(manifest.main === './dist/index.js', 'package main must use the built root')
  assertCondition(manifest.types === './dist/index.d.ts', 'package types must use the built root declaration')
  assertCondition(manifest.exports?.['.']?.default === './dist/index.js', 'root runtime export must use dist')
  assertCondition(manifest.exports?.['.']?.types === './dist/index.d.ts', 'root type export must use dist')
  assertCondition(manifest.exports?.['./harness']?.default === './dist/harness/plugin.js', 'Harness runtime export must use dist')
  assertCondition(manifest.exports?.['./harness']?.types === './dist/harness/plugin.d.ts', 'Harness type export must use dist')
  assertCondition(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'the dsh bundle patch declaration changed unexpectedly')
  assertCondition(JSON.stringify(manifest.files) === JSON.stringify(['dist/', 'cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE.md']), 'package files allowlist changed unexpectedly')

  // npm's Windows command shim is not an executable. Use the actual npm CLI
  // supplied by npm run, preserving separate arguments and shell:false.
  const npmCli = process.env.npm_execpath
  assertCondition(typeof npmCli === 'string' && basename(npmCli) === 'npm-cli.js' && existsSync(npmCli),
    'Run this verifier through npm run verify:built-artifact so the installed npm CLI is explicit')

  const build = buildArtifact({ projectRoot: repoRoot, projectDist: false })
  tempRoot = build.artifactRoot
  const distRoot = join(build.packageRoot, 'dist')
  assertCondition(existsSync(join(distRoot, 'index.js')), 'build is missing dist/index.js')
  assertCondition(existsSync(join(distRoot, 'index.d.ts')), 'build is missing dist/index.d.ts')
  assertCondition(existsSync(join(distRoot, 'harness', 'plugin.js')), 'build is missing dist/harness/plugin.js')
  assertCondition(existsSync(join(distRoot, 'harness', 'plugin.d.ts')), 'build is missing dist/harness/plugin.d.ts')
  for (const file of filesUnder(distRoot).filter((entry) => entry.endsWith('.js'))) {
    const contents = readFileSync(join(distRoot, file), 'utf8')
    assertCondition(!/(?:from\s+|import\s*\()['"][^'"]+\.(?:ts|tsx|mts|cts)['"]/.test(contents), `emitted JavaScript retains a TypeScript import: dist/${file}`)
  }

  const npmEnvironment = { ...process.env, npm_config_cache: join(tempRoot, 'npm-cache') }
  const packOutput = run(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', tempRoot], { cwd: build.packageRoot, env: npmEnvironment })
  const packResult = JSON.parse(packOutput)
  const packageFiles = packResult[0]?.files?.map((entry) => entry.path) ?? []
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/harness/plugin.js', 'dist/harness/plugin.d.ts', 'cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE.md']) {
    assertCondition(packageFiles.includes(required), `packed artifact is missing ${required}`)
  }
  for (const prohibited of ['src/', 'test/', 'examples/', 'openspec/', 'reference/', 'coverage/', '.dsh/']) {
    assertCondition(!packageFiles.some((file) => file.startsWith(prohibited)), `packed artifact includes prohibited path ${prohibited}`)
  }

  const tarballName = packResult[0]?.filename
  assertCondition(tarballName, 'npm pack did not create a tarball')
  const tarball = join(tempRoot, tarballName)
  const consumer = join(tempRoot, 'consumer')
  mkdirSync(consumer)
  run(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumer, tarball], { env: npmEnvironment })
  const installedPackage = JSON.parse(readFileSync(join(consumer, 'node_modules', manifest.name, 'package.json'), 'utf8'))
  assertCondition(installedPackage.name === 'dsh-repo-atlas', 'installed artifact lost the dsh-repo-atlas package identity')
  assertCondition(installedPackage.private === true, 'installed artifact lost private package metadata')
  assertCondition(installedPackage.license === 'MIT', 'installed artifact lost MIT metadata')
  assertCondition(installedPackage.exports?.['.']?.default === './dist/index.js', 'installed root export does not use dist')
  assertCondition(installedPackage.exports?.['./harness']?.default === './dist/harness/plugin.js', 'installed Harness export does not use dist')
  run(process.execPath, ['--input-type=module', '--eval', `
    const root = await import('dsh-repo-atlas')
    const harness = await import('dsh-repo-atlas/harness')
    if (typeof root.analyzeRepository !== 'function') throw new Error('root export missing analyzeRepository')
    if (typeof root.LocalRepositoryReader !== 'function') throw new Error('root export missing repository reader')
    if (harness.name !== 'dsh-repo-atlas' || typeof harness.apply !== 'function') throw new Error('Harness export shape is invalid')
    const tools = []
    harness.apply({ tools: { register: tool => tools.push(tool) } })
    if (!tools.some(tool => tool.name === 'repo_atlas_analyze')) throw new Error('built analysis tool did not register')
    if (!tools.some(tool => tool.name === 'repo_atlas_change_proposal')) throw new Error('built proposal tool did not register')
    if (!tools.some(tool => tool.name === 'repo_atlas_search') || !tools.some(tool => tool.name === 'repo_atlas_impact')) throw new Error('built intelligence tools did not register')
    if (tools.some(tool => tool.name === 'repo_atlas_symbols')) throw new Error('symbols must remain opt-in')
    harness.apply({ tools: { register: tool => tools.push(tool) } }, { symbols: { enabled: true } })
    if (!tools.some(tool => tool.name === 'repo_atlas_symbols')) throw new Error('built symbol tool did not register when enabled')
  `], { cwd: consumer, env: npmEnvironment })

  console.log(`PASS: built artifact offline install/import smoke (${basename(tarball)}).`)
} catch (error) {
  console.error(`FAIL: built artifact smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (tempRoot) console.log(`Artifacts retained at ${tempRoot}; no cleanup performed.`)
}
