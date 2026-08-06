import type {
  WorkspaceResourceInputSummary,
  WorkspaceResourceJsonObject,
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
  WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'

export interface WorkspaceCanvasPathFocusRequest {
  readonly requestId: string
  readonly workspacePath: string
}

export type WorkspaceCanvasResourceOperationKind = 'retry' | 'variant' | 'delete'

export type WorkspaceCanvasNodeActionKey =
  | 'discuss'
  | 'download'
  | 'preview_alternatives'
  | 'retry'
  | 'variant'
  | 'delete'

/**
 * Exact server-owned action input for a Resource card. Keeping the normalized
 * Operation input in the View prevents the renderer from rebuilding frozen
 * references, scope, or retry facts.
 */
export interface WorkspaceCanvasBillableOperationView {
  readonly kind: Exclude<WorkspaceCanvasResourceOperationKind, 'delete'>
  readonly operationId: string
  readonly confirmation: 'billable_media'
  readonly input: WorkspaceResourceJsonObject
}

export interface WorkspaceCanvasDeleteOperationView {
  readonly kind: 'delete'
  readonly operationId: string
  readonly confirmation: 'destructive'
  readonly input: {
    readonly resourceId: string
    readonly workspacePath: string
  }
  readonly approvalInputHash: string
}

export type WorkspaceCanvasResourceOperationView =
  | WorkspaceCanvasBillableOperationView
  | WorkspaceCanvasDeleteOperationView

/**
 * Client extension point for the Resource Card View. These optional fields are
 * absent on older servers; the UI then hides only the affected actions instead
 * of inventing capability or candidate facts.
 */
export type WorkspaceCanvasResourceFileView = WorkspaceResourceView & {
  readonly resourceKind: 'file'
  readonly mediaType: WorkspaceResourceMediaType
}

export interface WorkspaceCanvasResourcePreviewView {
  readonly resourceId: string
  readonly name: string
  readonly status: WorkspaceResourceStatus
  readonly mediaType: WorkspaceResourceMediaType
  readonly error: { readonly code: string | null; readonly message: string } | null
}

export type WorkspaceCanvasResourceSummaryView =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'structured'
      readonly entryCount: number | null
      readonly preview: string | null
    }
  | {
      readonly kind: 'media'
      readonly mediaType: WorkspaceResourceMediaType
      readonly url: string | null
      readonly mimeType: string | null
      readonly width: number | null
      readonly height: number | null
      readonly durationMs: number | null
    }
  | { readonly kind: 'empty' }

export interface WorkspaceResourceCardMemberView {
  readonly resource: WorkspaceCanvasResourcePreviewView
  readonly inputSummaries: readonly WorkspaceResourceInputSummary[]
  readonly download: { readonly href: string; readonly fileName: string } | null
  readonly presentation: {
    readonly rendererKey: string
    readonly fallbackMediaType: WorkspaceResourceMediaType
    readonly summary: WorkspaceCanvasResourceSummaryView
  }
}

export interface WorkspaceResourceCardView
  extends WorkspaceResourceCardMemberView {
  readonly resource: WorkspaceCanvasResourceFileView
  readonly alternativeGroup: {
    readonly groupId: string
    readonly total: number
    readonly members: readonly WorkspaceResourceCardMemberView[]
  } | null
  readonly canvasOperations: readonly WorkspaceCanvasResourceOperationView[]
}


export interface WorkspaceCanvasSelection {
  readonly nodeId: string
  readonly targetType: 'workspaceResource'
  readonly targetId: string
  readonly selectedScopeRef: string
  readonly selectedAssetId: string | null
  readonly name: string
  readonly mediaType: WorkspaceResourceMediaType
  readonly previewUrl: string | null
}

export interface WorkspaceAssistantDraftRequest {
  readonly requestId: string
  readonly text: string | null
  readonly focus: boolean
}

export interface WorkspaceCanvasUploadPlacement {
  readonly resourceId: string
  readonly position: { readonly x: number; readonly y: number }
}
