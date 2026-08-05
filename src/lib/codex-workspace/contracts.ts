import type { WorkspaceBundleV1 } from '@/lib/codex-runtime/workspace-bundle'

export const CODEX_WORKSPACE_SYSTEM_PREFIX = 'system/' as const
export const CODEX_WORKSPACE_PROJECT_FILE = 'system/project.json' as const

export type CodexWorkspaceProductionCapabilities = {
  readonly video: {
    readonly modelKey: string
    readonly aspectRatio: string
    readonly allowedSegmentDurationsSeconds: readonly number[]
    readonly minSegmentDurationSeconds: number
    readonly maxSegmentDurationSeconds: number
    readonly maxReferenceImages: number
    readonly maxReferenceAudios: number
    readonly supportsTextToVideo: boolean
  } | null
  readonly music: {
    readonly modelKey: string
    readonly promptMaxCharacters: number
    readonly durationSecondsOptions: readonly number[]
    readonly durationSecondsRange: {
      readonly min: number
      readonly max: number
    } | null
    readonly vocalModeOptions: readonly string[]
    readonly maxReferenceVideos: number
  } | null
}

export type CodexWorkspaceProjectSnapshot = {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly name: string
  readonly description: string | null
  readonly videoRatio: string | null
  readonly videoResolution: string
  readonly imageResolution: string
  readonly productionCapabilities: CodexWorkspaceProductionCapabilities
  readonly instructions: readonly string[]
}

export type CodexWorkspaceProjection = {
  readonly runtimeBundle: WorkspaceBundleV1
}
