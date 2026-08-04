import type { WorkspaceBundleV1 } from '@/lib/codex-runtime/workspace-bundle'
import type {
  WorkspaceResourceKind,
  WorkspaceResourceMediaType,
} from '@/lib/workspace-resource/contracts'

export const CODEX_WORKSPACE_SYSTEM_PREFIX = 'system/' as const
export const CODEX_WORKSPACE_PROJECT_FILE = 'system/project.json' as const
export const CODEX_WORKSPACE_SKILL_ROOT = 'system/skills' as const

export type CodexWorkspaceProjectSnapshot = {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly name: string
  readonly description: string | null
  readonly videoRatio: string | null
  readonly videoResolution: string
  readonly imageResolution: string
  readonly instructions: readonly string[]
}

export type CodexWorkspaceBaselineResource = {
  readonly resourceId: string
  readonly workspacePath: string
  readonly resourceKind: WorkspaceResourceKind
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly contentVersion: number
  readonly fileContent: string | null
  /** Runtime-local inode identity. It is never persisted as product state. */
  readonly runtimeIdentity: string | null
}

export type CodexWorkspaceDirectoryIdentity = {
  readonly path: string
  readonly runtimeIdentity: string
}

export type CodexWorkspaceBaseline = {
  readonly schemaVersion: 1
  readonly resources: readonly CodexWorkspaceBaselineResource[]
}

export type CodexWorkspaceProjection = {
  readonly runtimeBundle: WorkspaceBundleV1
  readonly baseline: CodexWorkspaceBaseline
  readonly skillEntryPaths: readonly string[]
}

export type CodexWorkspaceChange = {
  readonly kind: 'created' | 'updated' | 'moved' | 'deleted'
  readonly resourceId: string
  readonly beforePath: string | null
  readonly afterPath: string | null
}

export type CodexWorkspaceCapture = {
  readonly runtimeBundle: WorkspaceBundleV1
  readonly baseline: CodexWorkspaceBaseline
  readonly changes: readonly CodexWorkspaceChange[]
}

export type CodexWorkspaceErrorCode =
  | 'CODEX_WORKSPACE_PROTECTED_FILE_CHANGED'
  | 'CODEX_WORKSPACE_RUNTIME_PATH_INVALID'
  | 'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID'
  | 'CODEX_WORKSPACE_RESOURCE_ID_INVALID'
  | 'CODEX_WORKSPACE_RESOURCE_LIMIT_EXCEEDED'
  | 'CODEX_WORKSPACE_RESOURCE_CONFLICT'
  | 'CODEX_WORKSPACE_FOLDER_IDENTITY_INVALID'
  | 'CODEX_WORKSPACE_POINTER_EDIT_FORBIDDEN'

export class CodexWorkspaceError extends Error {
  readonly code: CodexWorkspaceErrorCode

  constructor(code: CodexWorkspaceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CodexWorkspaceError'
    this.code = code
  }
}
