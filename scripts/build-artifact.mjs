import { execFileSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const metadataFiles = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE.md']

export function filesUnder(root, relative = '') {
  const directory = join(root, relative)
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error(`Expected a real directory: ${directory}`)
  return readdirSync(directory).sort().flatMap(entry => {
    const child = join(relative, entry)
    const info = lstatSync(join(root, child))
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in build outputs: ${child}`)
    if (info.isDirectory()) return filesUnder(root, child)
    if (!info.isFile()) throw new Error(`Expected a regular output file: ${child}`)
    return [child.replaceAll('\\', '/')]
  })
}

export function buildArtifact({ projectRoot, compilerPath, projectDist = true }) {
  projectRoot = resolve(projectRoot)
  if (lstatSync(projectRoot).isSymbolicLink()) throw new Error('Project root must not be a symbolic link')
  const artifactParent = join(projectRoot, '.codex', 'artifacts')
  for (const directory of [join(projectRoot, '.codex'), artifactParent]) {
    if (!existsSync(directory)) mkdirSync(directory)
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error(`Artifact directory must be a real directory: ${directory}`)
  }
  const artifactRoot = mkdtempSync(join(artifactParent, 'build-'))
  const packageRoot = join(artifactRoot, 'package')
  const distRoot = join(packageRoot, 'dist')
  const resultFile = join(artifactRoot, 'result.json')
  mkdirSync(packageRoot)
  mkdirSync(distRoot)
  const result = { status: 'failed', artifactRoot, packageRoot, resultFile, projectDist, files: [] }
  try {
    const manifestInfo = lstatSync(join(projectRoot, 'package.json'))
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('Package metadata must be a regular file: package.json')
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    // A staged package is already built: consumers and pack must not run source lifecycle hooks.
    const stagedManifest = { ...manifest, scripts: undefined, devDependencies: undefined }
    writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`, { flag: 'wx' })
    for (const file of metadataFiles.slice(1)) {
      const source = join(projectRoot, file)
      if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) throw new Error(`Package metadata must be a regular file: ${file}`)
      copyFileSync(source, join(packageRoot, file), constants.COPYFILE_EXCL)
    }
    execFileSync(process.execPath, [compilerPath ?? join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--project', join(projectRoot, 'tsconfig.build.json'), '--outDir', distRoot, '--noEmitOnError',
    ], { cwd: projectRoot, shell: false, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024, timeout: 120_000 })
    for (const required of ['index.js', 'index.d.ts', 'harness/plugin.js', 'harness/plugin.d.ts']) {
      if (!existsSync(join(distRoot, required))) throw new Error(`Build is missing ${required}`)
    }
    const emitted = filesUnder(distRoot)
    // Source maps must not disclose the task directory or host checkout path.
    for (const file of emitted.filter(file => file.endsWith('.map'))) {
      const mapPath = join(distRoot, file)
      const map = JSON.parse(readFileSync(mapPath, 'utf8'))
      map.sourceRoot = ''
      map.sources = (map.sources ?? []).map(source => {
        const normalized = source.replaceAll('\\', '/')
        const marker = normalized.lastIndexOf('/src/')
        return marker >= 0 ? `repo-atlas-source:${normalized.slice(marker + 1)}` : 'repo-atlas-source:unavailable'
      })
      writeFileSync(mapPath, `${JSON.stringify(map)}\n`)
    }
    if (projectDist) {
      const target = join(projectRoot, 'dist')
      const existing = existsSync(target) ? filesUnder(target) : []
      const unexpected = existing.filter(file => !emitted.includes(file))
      if (unexpected.length) throw new Error(`Existing dist contains outputs absent from this build; preserve them and use --isolated. Unexpected: ${unexpected.slice(0, 10).join(', ')}`)
      if (!existsSync(target)) mkdirSync(target)
      for (const file of emitted) {
        mkdirSync(dirname(join(target, file)), { recursive: true })
        copyFileSync(join(distRoot, file), join(target, file))
      }
    }
    result.files = filesUnder(packageRoot)
    result.status = 'passed'
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
    return result
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n').slice(0, 4000)
    result.error = `${error instanceof Error ? error.message : String(error)}${output ? `\n${output}` : ''}`
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
    throw new Error(`Build failed; artifacts retained at ${artifactRoot}: ${result.error}`)
  }
}
