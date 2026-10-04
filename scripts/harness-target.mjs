import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Explicit, pinned candidates never overwrite historical accepted support. */
export function harnessTarget(repoRoot, args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--candidate') || args.length > 1) throw new Error('Only the optional --candidate flag is supported')
  const candidate = args.includes('--candidate')
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'reference', candidate ? 'harness-candidate.json' : 'harness-compatibility.json'), 'utf8'))
  if (!/^[a-f0-9]{40}$/.test(manifest.revision)) throw new Error('Harness target must pin an exact Git revision')
  if (candidate && manifest.status !== 'experimental-prerelease') throw new Error('Candidate status must stay experimental-prerelease')
  return { ...manifest, candidate }
}
