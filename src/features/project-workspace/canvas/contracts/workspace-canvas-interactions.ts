import type {
  CreativeResourceCardView,
  CreativeResourceCanvasOperationView,
  CreativeResourceCardMemberView,
  CreativeResourceMediaType,
} from '@/lib/creative-resource/contracts'
import type { CanvasCreationActionView } from '@/lib/operations/canvas-action-catalog'

export const WORKSPACE_CANVAS_CREATE_KINDS = [
  'image',
  'video',
  'music',
  'voice',
] as const

export type WorkspaceCanvasCreateKind = typeof WORKSPACE_CANVAS_CREATE_KINDS[number]

/**
 * Server-projected create capability. The browser renders the small 1.0 form,
 * but never guesses whether an Operation is available or what count range it
 * accepts.
 */
export type WorkspaceCanvasCreateCapabilityView = CanvasCreationActionView

export type WorkspaceCanvasResourceOperationKind = CreativeResourceCanvasOperationView['kind']

export type WorkspaceCanvasNodeActionKey =
  | 'discuss'
  | 'download'
  | 'preview_alternatives'
  | 'retry'
  | 'variant'
  | 'archive'
  | 'restore'
  | 'hide'
  | 'show'

/**
 * Exact server-owned action input for a Resource card. Keeping the normalized
 * Operation input in the View prevents the renderer from rebuilding frozen
 * references, scope, or retry facts.
 */
export type WorkspaceCanvasResourceOperationView = CreativeResourceCanvasOperationView

/**
 * Client extension point for the Resource Card View. These optional fields are
 * absent on older servers; the UI then hides only the affected actions instead
 * of inventing capability or candidate facts.
 */
export type WorkspaceCreativeResourceCardView = CreativeResourceCardView

export type WorkspaceCreativeResourceCardMemberView = CreativeResourceCardMemberView

export interface WorkspaceCanvasSelection {
  readonly nodeId: string
  readonly targetType: 'creativeResource'
  readonly targetId: string
  readonly selectedScopeRef: string
  readonly selectedAssetId: string | null
  readonly name: string
  readonly mediaType: CreativeResourceMediaType
  readonly previewUrl: string | null
}

export interface WorkspaceAssistantDraftRequest {
  readonly requestId: string
  readonly text: string | null
  readonly focus: boolean
}

export interface WorkspaceCanvasCreateRequest {
  readonly capability: WorkspaceCanvasCreateCapabilityView
  readonly name: string
  readonly prompt: string
  readonly count: number
  readonly durationSeconds: number | null
  readonly voicePreviewText: string
  readonly position: { readonly x: number; readonly y: number }
}

export interface WorkspaceCanvasUploadPlacement {
  readonly resourceId: string
  readonly position: { readonly x: number; readonly y: number }
}
