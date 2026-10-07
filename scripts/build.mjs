import { buildArtifact } from './build-artifact.mjs'

try {
  if (process.argv.slice(2).some(arg => arg !== '--isolated')) throw new Error('Usage: node scripts/build.mjs [--isolated]')
  const result = buildArtifact({ projectRoot: process.cwd(), projectDist: !process.argv.includes('--isolated') })
  console.error(`PASS: fresh ESM and declaration build. Package retained at ${result.packageRoot}`)
  console.error(`Build record: ${result.resultFile}`)
} catch (error) {
  console.error(`FAIL: RepoAtlas build failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : 1
}
