export class PatchApplicationError extends Error {
  readonly uncertain: boolean

  constructor(message: string, uncertain: boolean) {
    super(message)
    this.name = 'PatchApplicationError'
    this.uncertain = uncertain
  }
}

export class CommitOperationError extends Error {
  readonly uncertain: boolean

  constructor(message: string, uncertain: boolean) {
    super(message)
    this.name = 'CommitOperationError'
    this.uncertain = uncertain
  }
}

export class LandingOperationError extends Error {
  readonly uncertain: boolean

  constructor(message: string, uncertain: boolean) {
    super(message)
    this.name = 'LandingOperationError'
    this.uncertain = uncertain
  }
}

export class LandingInspectionError extends Error {
  readonly targetUnavailable: boolean

  constructor(message: string, targetUnavailable = false) {
    super(message)
    this.name = 'LandingInspectionError'
    this.targetUnavailable = targetUnavailable
  }
}
