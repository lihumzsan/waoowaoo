export const CREATIVE_RESOURCE_MEDIA_TYPES = ['text', 'image', 'audio', 'video'] as const
export type CreativeResourceMediaType = typeof CREATIVE_RESOURCE_MEDIA_TYPES[number]

export const CREATIVE_RESOURCE_SCOPE_KINDS = ['user', 'project', 'episode'] as const
export type CreativeResourceScopeKind = typeof CREATIVE_RESOURCE_SCOPE_KINDS[number]

export const CREATIVE_RESOURCE_STATUSES = ['pending', 'ready', 'failed', 'canceled'] as const
export type CreativeResourceStatus = typeof CREATIVE_RESOURCE_STATUSES[number]

export const CREATIVE_RESOURCE_CANONICAL_BINDINGS = {
  adoptedCreativeDirection: {
    role: 'adopted_creative_direction',
    slotKey: 'primary',
  },
  adoptedAssetManifest: {
    role: 'adopted_asset_manifest',
    slotKey: 'primary',
  },
} as const

export const CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE = 'character_voice'
export const CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE = 'project_asset_image'

export const CREATIVE_RESOURCE_BINDING_ROLES = [
  CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection.role,
  CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest.role,
  CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
  CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE,
] as const

export type CreativeResourceBindingRole = typeof CREATIVE_RESOURCE_BINDING_ROLES[number]

export type CreativeResourceCanonicalBinding = typeof CREATIVE_RESOURCE_CANONICAL_BINDINGS[
  keyof typeof CREATIVE_RESOURCE_CANONICAL_BINDINGS
]

export type CreativeResourceJsonObject = {
  readonly [key: string]: CreativeResourceJsonValue
}

export type CreativeResourceJsonValue =
  | string
  | number
  | boolean
  | null
  | CreativeResourceJsonValue[]
  | CreativeResourceJsonObject

export interface CreativeResourceScopeRef {
  readonly kind: CreativeResourceScopeKind
  readonly id: string
  readonly userId: string
  readonly projectId: string | null
  readonly episodeId: string | null
}

export interface CreativeResourceRef {
  readonly resourceId: string
}

export type CreativeResourceMaterializedRef = CreativeResourceRef

export interface CreativeResourceLinkView extends CreativeResourceMaterializedRef {
  readonly mediaType: CreativeResourceMediaType
  readonly schemaId: string
  readonly resourceName: string
  readonly fileName: string
  readonly href: string | null
  readonly mimeType: string | null
}

export interface CreativeResourceInputRef extends CreativeResourceRef {
  readonly role: string
  readonly position: number
}

export interface CreativeResourceGenerationProvenance {
  readonly operationId: string | null
  readonly inputHash: string | null
  readonly taskId: string | null
  readonly operationExecutionId: string | null
  readonly toolCallId: string | null
  readonly prompt: string | null
  readonly modelKey: string | null
  readonly generationOptions: CreativeResourceJsonValue | null
}

export interface CreativeResourcePendingGeneration {
  readonly taskId: string
  readonly operationId: string | null
  readonly prompt: string | null
  readonly modelKey: string | null
  readonly generationOptions: CreativeResourceJsonValue | null
  readonly inputs: readonly CreativeResourceInputRef[]
}

export type CreativeResourceContent =
  | {
      readonly kind: 'text'
      readonly text: string
    }
  | {
      readonly kind: 'structured'
      readonly data: CreativeResourceJsonValue
    }
  | {
      readonly kind: 'media'
      readonly mediaId: string
      readonly url?: string
      readonly mimeType?: string | null
      readonly width?: number | null
      readonly height?: number | null
      readonly durationMs?: number | null
    }

export interface CreativeResourceMaterializationView {
  readonly content: CreativeResourceContent
  readonly provenance: CreativeResourceGenerationProvenance
  readonly inputs: readonly CreativeResourceInputRef[]
  readonly materializedAt: string
}

export interface CreativeResourceBindingView {
  readonly bindingId: string
  readonly scope: CreativeResourceScopeRef
  readonly role: CreativeResourceBindingRole
  readonly slotKey: string
  readonly resourceId: string
  readonly version: number
  readonly source: string
}

export interface CreativeResourceView {
  readonly resourceId: string
  readonly origin: {
    readonly sourceType: string
    readonly sourceId: string
  } | null
  readonly scope: CreativeResourceScopeRef
  readonly mediaType: CreativeResourceMediaType
  readonly schemaId: string
  readonly name: string
  readonly status: CreativeResourceStatus
  readonly alternativeGroupId: string | null
  readonly memberIndex: number | null
  readonly archivedAt: string | null
  readonly creativeDataVersion: number
  readonly creativeDataKeys: readonly string[]
  readonly materialization: CreativeResourceMaterializationView | null
  readonly pendingGeneration: CreativeResourcePendingGeneration | null
  readonly error: {
    readonly code: string | null
    readonly message: string
  } | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreativeResourceDataView {
  readonly resourceId: string
  readonly creativeData: CreativeResourceJsonObject
  readonly creativeDataVersion: number
}

export type CreativeResourceSummaryView =
  | {
      readonly kind: 'text'
      readonly text: string
    }
  | {
      readonly kind: 'structured'
      readonly entryCount: number | null
    }
  | {
      readonly kind: 'media'
      readonly mediaType: CreativeResourceMediaType
      readonly url?: string
      readonly mimeType?: string | null
      readonly width?: number | null
      readonly height?: number | null
      readonly durationMs?: number | null
    }
  | {
      readonly kind: 'empty'
    }

export interface CreativeResourceCurrentSelectionView {
  readonly kind: CreativeResourceBindingRole
  readonly targetId: string
  readonly resourceId: string
  readonly schemaId: string
  readonly mediaType: CreativeResourceMediaType
  readonly name: string
}

export interface CreativeResourceWorkingSetView {
  readonly adoptedCreativeDirection: CreativeResourceCurrentSelectionView | null
  readonly adoptedAssetManifest: CreativeResourceCurrentSelectionView | null
  readonly currentSelections: readonly CreativeResourceCurrentSelectionView[]
  readonly availableResources: {
    readonly total: number
    readonly bySchema: ReadonlyArray<{
      readonly schemaId: string
      readonly count: number
    }>
  }
}

export interface CreativeResourceInputMediaPreview {
  readonly url: string
  readonly mimeType: string | null
  readonly width: number | null
  readonly height: number | null
  readonly durationMs: number | null
}

/**
 * A resolved preview of one generation input reference. The server projects
 * these once per card so the UI never re-fetches or guesses referenced
 * Resources from raw IDs (CR-19).
 */
export interface CreativeResourceInputSummaryView extends CreativeResourceInputRef {
  readonly name: string
  readonly mediaType: CreativeResourceMediaType
  readonly media: CreativeResourceInputMediaPreview | null
}

export interface CreativeResourceDownloadView {
  readonly href: string
  readonly fileName: string
}

export type CreativeResourceCanvasOperationKind = 'retry' | 'variant' | 'edit_regenerate'

export interface CreativeResourceCanvasOperationView {
  readonly kind: CreativeResourceCanvasOperationKind
  readonly operationId: string
  readonly confirmation: 'billable_media'
  readonly input: CreativeResourceJsonObject
  readonly editableInputPath: readonly string[] | null
}

export interface CreativeResourceCardMemberView {
  readonly resource: CreativeResourceView
  readonly inputSummaries: readonly CreativeResourceInputSummaryView[]
  readonly download: CreativeResourceDownloadView | null
  readonly presentation: {
    readonly rendererKey: string
    readonly fallbackMediaType: CreativeResourceMediaType
    readonly summary: CreativeResourceSummaryView
  }
}

export interface CreativeResourceAlternativeGroupView {
  readonly groupId: string
  readonly total: number
  readonly members: readonly CreativeResourceCardMemberView[]
}

export interface CreativeResourceCardView extends CreativeResourceCardMemberView {
  /**
   * Browsing relation only. It never identifies a selected/current/adopted
   * member; the currently visible member belongs to local UI state.
   */
  readonly alternativeGroup: CreativeResourceAlternativeGroupView | null
  readonly canvasOperations: readonly CreativeResourceCanvasOperationView[]
}

export type CreativeResourceAlternativeMediaKind = 'image' | 'video' | 'music' | 'voice'

export interface CreativeResourceAlternativeGenerationCapability {
  readonly kind: 'request_count'
  readonly mediaKind: CreativeResourceAlternativeMediaKind
  readonly requestKind: 'new' | 'single'
  readonly minCount: 1
  readonly maxCount: 6
  readonly inputLimits?: {
    readonly durationSeconds?: {
      readonly min: number
      readonly max: number
    }
    readonly promptMaxLength?: number
    readonly previewTextMaxLength?: number
  }
}

export type CreativeResourceOperationContract =
  | {
      readonly kind: 'none'
      readonly reason: string
    }
  | {
      readonly kind: 'resource'
      readonly assistantPresentation: 'none' | 'created_resources'
      readonly acceptsReferences: boolean
      readonly outputMediaTypes: readonly CreativeResourceMediaType[]
      readonly outputSchemaIds: readonly string[]
      readonly alternativeGeneration?: CreativeResourceAlternativeGenerationCapability
    }

export function isCreativeResourceMediaType(value: unknown): value is CreativeResourceMediaType {
  return typeof value === 'string' && CREATIVE_RESOURCE_MEDIA_TYPES.some((item) => item === value)
}

export function isCreativeResourceScopeKind(value: unknown): value is CreativeResourceScopeKind {
  return typeof value === 'string' && CREATIVE_RESOURCE_SCOPE_KINDS.some((item) => item === value)
}

export function isCreativeResourceStatus(value: unknown): value is CreativeResourceStatus {
  return typeof value === 'string' && CREATIVE_RESOURCE_STATUSES.some((item) => item === value)
}

export function isCreativeResourceBindingRole(value: unknown): value is CreativeResourceBindingRole {
  return typeof value === 'string'
    && CREATIVE_RESOURCE_BINDING_ROLES.some((role) => role === value)
}
