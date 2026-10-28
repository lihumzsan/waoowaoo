import { AppError } from '@/lib/errors/app-error'
import type { WorkspaceResourceMediaType } from '@/lib/workspace-resource/contracts'
import {
  WORKSPACE_RESOURCE_SCHEMA,
  type WorkspaceResourceSchemaId,
} from '@/lib/workspace-resource/schema-registry'
import type {
  CompositionTarget,
  VideoComposition,
} from './composition-contract'
import type { VideoMergeAudioMode } from './audio-contract'

type CompositionTargetDefinition = {
  readonly mediaType: WorkspaceResourceMediaType
  readonly schemaId: WorkspaceResourceSchemaId
  readonly mimeType: string
  readonly extension: string
  readonly audioModes: readonly VideoMergeAudioMode[]
  readonly textLayers: boolean
  readonly timedAudioCues: boolean
  readonly maxInputBytes: number
}

export const COMPOSITION_TARGETS = {
  mp4: {
    mediaType: 'video',
    schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
    mimeType: 'video/mp4',
    extension: 'mp4',
    audioModes: ['preserve', 'mix', 'replace', 'mute'],
    textLayers: false,
    timedAudioCues: true,
    maxInputBytes: 256 * 1024 * 1024,
  },
  jianying_project: {
    mediaType: 'archive',
    schemaId: WORKSPACE_RESOURCE_SCHEMA.JIANYING_PROJECT,
    mimeType: 'application/zip',
    extension: 'zip',
    audioModes: ['preserve', 'mute'],
    textLayers: true,
    timedAudioCues: false,
    maxInputBytes: 256 * 1024 * 1024,
  },
} as const satisfies Record<CompositionTarget, CompositionTargetDefinition>

export function validateCompositionTarget(
  target: CompositionTarget,
  composition: VideoComposition,
): void {
  const definition: CompositionTargetDefinition = COMPOSITION_TARGETS[target]
  if (!definition.audioModes.includes(composition.audio.mode))
    throw new AppError('COMPOSITION_TARGET_UNSUPPORTED')
  if (
    !definition.timedAudioCues &&
    composition.audio.musicCues.length + composition.audio.soundCues.length > 0
  )
    throw new AppError('COMPOSITION_TARGET_UNSUPPORTED')
  if (!definition.textLayers && composition.textLayers.length > 0)
    throw new AppError('COMPOSITION_TARGET_UNSUPPORTED')
}
