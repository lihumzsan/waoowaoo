import type { WorkspaceBundleV1 } from '@/lib/codex-runtime/workspace-bundle'

export const CODEX_WORKSPACE_SYSTEM_PREFIX = 'system/' as const
export const CODEX_WORKSPACE_AUTHORING_PREFIX = 'authoring/' as const
export const CODEX_WORKSPACE_PROJECT_FILE = 'system/project.json' as const
export const CODEX_WORKSPACE_RESOURCE_INDEX_FILE = 'system/resources.json' as const
export const CODEX_WORKSPACE_SKILL_ROOT = 'system/skills' as const

export type CodexWorkspaceCurrentSelection = {
  readonly kind: string
  readonly targetId: string
  readonly resourceId: string
  readonly schemaId: string
  readonly mediaType: 'text' | 'image' | 'audio' | 'video'
  readonly name: string
}

export type CodexWorkspaceProjectSnapshot = {
  readonly schemaVersion: 1
  readonly project: {
    readonly projectId: string
    readonly name: string
    readonly videoRatio: string | null
  }
  readonly episode: {
    readonly episodeId: string
    readonly name: string
  } | null
  readonly currentSelections: readonly CodexWorkspaceCurrentSelection[]
}

export type CodexWorkspaceResourcePointer = {
  readonly resourceId: string
  readonly scope: {
    readonly kind: 'user' | 'project' | 'episode'
    readonly projectId: string | null
    readonly episodeId: string | null
  }
  readonly name: string
  readonly mediaType: 'text' | 'image' | 'audio' | 'video'
  readonly schemaId: string
  readonly prompt: string | null
  readonly contentPath: string | null
  readonly media: {
    readonly mimeType: string | null
    readonly width: number | null
    readonly height: number | null
    readonly durationMs: number | null
  } | null
  readonly inputs: readonly {
    readonly resourceId: string
    readonly role: string
    readonly position: number
  }[]
}

export type CodexWorkspaceResourceIndex = {
  readonly schemaVersion: 1
  readonly resources: readonly CodexWorkspaceResourcePointer[]
}

export type CodexWorkspaceProjection = {
  /** Ephemeral runtime bundle. Only its authoring/** subset may be persisted. */
  readonly runtimeBundle: WorkspaceBundleV1
  /** Workspace-relative skill entry paths; the Runtime owns absolute path mapping. */
  readonly skillEntryPaths: readonly string[]
}

export type CodexAuthoringChange = {
  readonly kind: 'created' | 'updated' | 'deleted'
  readonly path: string
}

export type CodexAuthoringWriteback = {
  /** The only bundle that may be saved to the S3 workspace store. */
  readonly authoringBundle: WorkspaceBundleV1
  readonly changes: readonly CodexAuthoringChange[]
}

export type CodexWorkspaceErrorCode =
  | 'CODEX_WORKSPACE_AUTHORING_PATH_REQUIRED'
  | 'CODEX_WORKSPACE_PROTECTED_FILE_CHANGED'
  | 'CODEX_WORKSPACE_RUNTIME_PATH_INVALID'
  | 'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID'
  | 'CODEX_WORKSPACE_RESOURCE_ID_INVALID'
  | 'CODEX_WORKSPACE_RESOURCE_LIMIT_EXCEEDED'

export class CodexWorkspaceError extends Error {
  readonly code: CodexWorkspaceErrorCode

  constructor(code: CodexWorkspaceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CodexWorkspaceError'
    this.code = code
  }
}
