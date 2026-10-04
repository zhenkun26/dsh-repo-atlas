export interface BuildArtifactResult {
  status: 'passed'
  artifactRoot: string
  packageRoot: string
  resultFile: string
  projectDist: boolean
  files: string[]
}
export function filesUnder(root: string, relative?: string): string[]
export function buildArtifact(options: { projectRoot: string; compilerPath?: string; projectDist?: boolean }): BuildArtifactResult
