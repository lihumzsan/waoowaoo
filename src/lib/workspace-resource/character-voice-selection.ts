import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { getProjectModelConfig } from '@/lib/config-service'
import { VOICE_CHARACTER_REFERENCE_ROLE } from '@/lib/voice/voice-design-contract'
import { lockOwnedProject } from './persistence'
import { advanceWorkspaceResourceRevisionInTransaction } from './projection-revision'
import { WORKSPACE_RESOURCE_SCHEMA } from './schema-registry'
import type { SelectCharacterVoiceInput } from './selection-contract'

export interface CharacterVoiceDurationLimits {
  readonly minDurationMs: number
  readonly maxDurationMs: number
}

export async function readCharacterVoiceDurationLimits(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<CharacterVoiceDurationLimits | null> {
  const config = await getProjectModelConfig(input.projectId, input.userId)
  const video = config.videoModel
    ? resolveBuiltinCapabilitiesByModelKey('video', config.videoModel)?.video
    : undefined
  if (
    video?.promptProfile !== 'minimax_h3_multimodal_v3'
    || !video.supportedInputModes?.includes('reference')
    || !video.maxReferenceAudios
    || video.minReferenceAudioDurationMs === undefined
    || video.maxTotalReferenceAudioDurationMs === undefined
  ) return null
  return {
    minDurationMs: video.minReferenceAudioDurationMs,
    maxDurationMs: video.maxTotalReferenceAudioDurationMs,
  }
}

export function isCharacterVoiceDurationAvailable(
  durationMs: number | null,
  limits: CharacterVoiceDurationLimits | null,
): boolean {
  return durationMs !== null && limits !== null
    && durationMs >= limits.minDurationMs && durationMs <= limits.maxDurationMs
}

export async function selectCharacterVoiceInTransaction(
  tx: Prisma.TransactionClient,
  input: SelectCharacterVoiceInput & {
    readonly userId: string
    readonly projectId: string
  },
): Promise<{
  readonly characterResourceId: string
  readonly voiceResourceId: string
  readonly voiceContentVersion: number
  readonly selectionRevision: number
}> {
  await lockOwnedProject(tx, input.projectId, input.userId)
  const character = await tx.workspaceResource.findFirst({
    where: {
      id: input.characterResourceId,
      userId: input.userId,
      projectId: input.projectId,
      resourceKind: 'file',
      mediaType: 'image',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
      status: 'ready',
      deletedAt: null,
    },
    select: { id: true, selectedVoiceRevision: true },
  })
  if (!character) {
    throw new ApiError('NOT_FOUND', { code: 'CHARACTER_VOICE_CHARACTER_NOT_AVAILABLE' })
  }
  if (character.selectedVoiceRevision !== input.expectedSelectionRevision) {
    throw new ApiError('CONFLICT', { code: 'CHARACTER_VOICE_SELECTION_CHANGED' })
  }
  const voice = await tx.workspaceResourceVersion.findFirst({
    where: {
      resourceId: input.voiceResourceId,
      version: input.voiceContentVersion,
      contentKind: 'media',
      resource: {
        userId: input.userId,
        projectId: input.projectId,
        resourceKind: 'file',
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        status: 'ready',
        deletedAt: null,
      },
    },
    select: { id: true, media: { select: { durationMs: true } } },
  })
  if (!voice) throw new ApiError('NOT_FOUND', { code: 'CHARACTER_VOICE_AUDIO_NOT_AVAILABLE' })
  const characterReferences = await tx.workspaceResourceLineage.findMany({
    where: {
      outputResourceId: input.voiceResourceId,
      outputVersion: input.voiceContentVersion,
      role: VOICE_CHARACTER_REFERENCE_ROLE,
    },
    select: { inputResourceId: true, inputVersion: true },
  })
  if (characterReferences.length !== 1 || characterReferences[0].inputResourceId !== character.id) {
    throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_VOICE_SOURCE_MISMATCH' })
  }
  const sourceVersion = await tx.workspaceResourceVersion.findUnique({
    where: {
      resourceId_version: {
        resourceId: character.id,
        version: characterReferences[0].inputVersion,
      },
    },
    select: { id: true },
  })
  if (!sourceVersion) throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_VOICE_SOURCE_VERSION_MISSING' })
  const limits = await readCharacterVoiceDurationLimits(input)
  if (!limits) throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_VOICE_VIDEO_CAPABILITY_REQUIRED' })
  if (!isCharacterVoiceDurationAvailable(voice.media.durationMs, limits)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CHARACTER_VOICE_DURATION_INVALID',
      actualDurationMs: voice.media.durationMs,
      minDurationMs: limits.minDurationMs,
      maxDurationMs: limits.maxDurationMs,
    })
  }
  const updated = await tx.workspaceResource.updateMany({
    where: { id: character.id, selectedVoiceRevision: input.expectedSelectionRevision },
    data: { selectedVoiceVersionId: voice.id, selectedVoiceRevision: { increment: 1 } },
  })
  if (updated.count !== 1) throw new ApiError('CONFLICT', { code: 'CHARACTER_VOICE_SELECTION_CHANGED' })
  await advanceWorkspaceResourceRevisionInTransaction(tx, input)
  return {
    characterResourceId: character.id,
    voiceResourceId: input.voiceResourceId,
    voiceContentVersion: input.voiceContentVersion,
    selectionRevision: input.expectedSelectionRevision + 1,
  }
}

/** Only used inside the transaction that permanently deletes the entire project. */
export async function clearProjectCharacterVoiceSelectionsInTransaction(
  tx: Prisma.TransactionClient,
  input: { readonly projectId: string },
): Promise<void> {
  const externalSelection = await tx.workspaceResource.findFirst({
    where: {
      projectId: { not: input.projectId },
      selectedVoiceVersion: { resource: { projectId: input.projectId } },
    },
    select: { id: true },
  })
  if (externalSelection) throw new ApiError('CONFLICT', { code: 'PROJECT_RESOURCE_EXTERNAL_VOICE_CONFLICT' })
  await tx.workspaceResource.updateMany({
    where: { projectId: input.projectId, selectedVoiceVersionId: { not: null } },
    data: { selectedVoiceVersionId: null },
  })
}
