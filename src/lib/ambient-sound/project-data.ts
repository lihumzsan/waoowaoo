import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  AMBIENT_SOUND_STATUS,
  type AmbientSoundMix,
  type AmbientSoundProjectData,
  type AmbientSoundSourceAsset,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseAmbientSoundMix(value: unknown): AmbientSoundMix | null {
  if (!isRecord(value)) return null
  const mediaId = readString(value, 'mediaId')
  const url = readString(value, 'url')
  const storageKey = readString(value, 'storageKey')
  const mimeType = readString(value, 'mimeType')
  const durationMs = readNumber(value, 'durationMs')
  if (!mediaId || !url || !storageKey || !mimeType || durationMs === null || durationMs <= 0) return null
  return { mediaId, url, storageKey, mimeType, durationMs }
}

function parseAmbientSoundSource(value: unknown): AmbientSoundSourceAsset | null {
  if (!isRecord(value)) return null
  const sourceId = readString(value, 'sourceId')
  const environmentFingerprint = readString(value, 'environmentFingerprint')
  const prompt = readString(value, 'prompt')
  const mediaId = readString(value, 'mediaId')
  const url = readString(value, 'url')
  const storageKey = readString(value, 'storageKey')
  const mimeType = readString(value, 'mimeType')
  const durationMs = readNumber(value, 'durationMs')
  const loopDurationSeconds = readNumber(value, 'loopDurationSeconds')
  const promptInfluence = readNumber(value, 'promptInfluence')
  const soundEffectModel = readString(value, 'soundEffectModel')
  if (
    !sourceId ||
    !environmentFingerprint ||
    !prompt ||
    !mediaId ||
    !url ||
    !storageKey ||
    !mimeType ||
    durationMs === null ||
    durationMs <= 0 ||
    loopDurationSeconds === null ||
    loopDurationSeconds <= 0 ||
    promptInfluence === null ||
    !soundEffectModel
  ) {
    return null
  }
  return {
    sourceId,
    environmentFingerprint,
    prompt,
    mediaId,
    url,
    storageKey,
    mimeType,
    durationMs,
    loopDurationSeconds,
    promptInfluence,
    soundEffectModel,
  }
}

export function readCompletedAmbientSoundMix(input: {
  readonly status: string | null
  readonly mixJson?: unknown
} | null | undefined): AmbientSoundMix | null {
  if (!input || input.status !== AMBIENT_SOUND_STATUS.COMPLETED) return null
  return parseAmbientSoundMix(input.mixJson)
}

export function readAmbientSoundTimelineSignature(input: {
  readonly timelineSignature?: string | null
} | null | undefined): string | null {
  const value = input?.timelineSignature
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function readAmbientSoundDecision(input: {
  readonly planJson?: unknown
} | null | undefined): 'ambient_sound' | 'none_needed' | null {
  const planJson = input?.planJson
  if (!isRecord(planJson)) return null
  const decision = planJson.decision
  return decision === 'ambient_sound' || decision === 'none_needed' ? decision : null
}

export function readAmbientSoundSources(value: unknown): AmbientSoundSourceAsset[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseAmbientSoundSource)
    .filter((source): source is AmbientSoundSourceAsset => source !== null)
}

export function readAmbientSoundSourcesStrict(value: unknown): AmbientSoundSourceAsset[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error('AMBIENT_SOUND_SOURCES_JSON_INVALID')
  return value.map((source, index) => {
    const parsed = parseAmbientSoundSource(source)
    if (!parsed) throw new Error(`AMBIENT_SOUND_SOURCE_JSON_INVALID:${index}`)
    return parsed
  })
}

export async function writeAmbientSoundProjectData(input: {
  readonly episodeId: string
  readonly ambientSound: AmbientSoundProjectData
}): Promise<void> {
  const planJson = input.ambientSound.plan
    ? input.ambientSound.plan as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull
  const sourcesJson = input.ambientSound.sources
    ? input.ambientSound.sources as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull
  const mixJson = input.ambientSound.mix
    ? input.ambientSound.mix as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull
  const diagnosticsJson = input.ambientSound.errorMessage
    ? { errorMessage: input.ambientSound.errorMessage } as Prisma.InputJsonValue
    : Prisma.JsonNull

  await prisma.projectEditAmbientSound.upsert({
    where: { episodeId: input.episodeId },
    create: {
      episodeId: input.episodeId,
      planJson,
      sourcesJson,
      mixJson,
      diagnosticsJson,
      status: input.ambientSound.status,
      taskId: input.ambientSound.taskId,
      planTaskId: input.ambientSound.planTaskId,
      timelineSignature: input.ambientSound.timelineSignature,
      soundEffectModel: input.ambientSound.soundEffectModel,
    },
    update: {
      planJson,
      sourcesJson,
      mixJson,
      diagnosticsJson,
      status: input.ambientSound.status,
      taskId: input.ambientSound.taskId,
      planTaskId: input.ambientSound.planTaskId,
      timelineSignature: input.ambientSound.timelineSignature,
      soundEffectModel: input.ambientSound.soundEffectModel,
    },
  })
}
