import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

export interface E2eTaskDiagnostic {
  readonly id: string
  readonly type: string
  readonly targetType: string
  readonly targetId: string
  readonly status: string
  readonly progress: number
  readonly operationId: string | null
  readonly batchKey: string | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly updatedAt: string
}

export interface E2eChapterDiagnostic {
  readonly id: string
  readonly chapterIndex: number
  readonly status: string
  readonly renderStatus: string | null
  readonly editScript: {
    readonly id: string
    readonly status: string
    readonly assetReviewStatus: string
    readonly shotCount: number
    readonly requirementCount: number
    readonly pendingRequirementCount: number
  } | null
  readonly shotExecutionPlanStatus: string | null
}

export interface E2eDiagnostics {
  readonly project: {
    readonly id: string
    readonly userId: string
    readonly name: string
    readonly videoRatio: string
  }
  readonly episode: {
    readonly id: string
    readonly name: string
    readonly episodeNumber: number
  }
  readonly workflow: EditFirstWorkflowState
  readonly sourceDocuments: readonly {
    readonly id: string
    readonly sourceKind: string
    readonly version: number
    readonly textLength: number
  }[]
  readonly bible: {
    readonly id: string
    readonly status: string
    readonly version: number
    readonly lockedAt: string | null
  } | null
  readonly stylePreviews: readonly {
    readonly id: string
    readonly status: string
    readonly aspectRatio: string
  }[]
  readonly chapters: readonly E2eChapterDiagnostic[]
  readonly finalOutput: {
    readonly renderStatus: string | null
    readonly hasOutput: boolean
  } | null
  readonly musicScore: {
    readonly status: string
    readonly hasMix: boolean
  } | null
  readonly tasks: readonly E2eTaskDiagnostic[]
  readonly runs: readonly {
    readonly id: string
    readonly status: string
    readonly controlKind: string
    readonly errorCode: string | null
    readonly updatedAt: string
  }[]
  readonly waits: readonly {
    readonly id: string
    readonly status: string
    readonly operationId: string
    readonly terminalStatus: string | null
    readonly updatedAt: string
  }[]
  readonly interruptions: readonly {
    readonly id: string
    readonly runId: string | null
    readonly status: string
    readonly type: string
    readonly operationId: string
    readonly toolCallId: string | null
    readonly updatedAt: string
  }[]
  readonly event: {
    readonly count: number
    readonly latestId: string | null
  }
}
