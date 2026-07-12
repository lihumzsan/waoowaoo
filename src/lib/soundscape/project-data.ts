import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  SOUNDSCAPE_STATUS,
  type SoundscapeMix,
  type SoundscapeProjectData,
  type SoundscapeSourceAsset,
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

function parseSoundscapeMix(value: unknown): SoundscapeMix | null {
  if (!isRecord(value)) return null
  const mediaId = readString(value, 'mediaId')
  const url = readString(value, 'url')
  const storageKey = readString(value, 'storageKey')
  const mimeType = readString(value, 'mimeType')
  const durationMs = readNumber(value, 'durationMs')
  if (!mediaId || !url || !storageKey || !mimeType || durationMs === null || durationMs <= 0) return null
  return { mediaId, url, storageKey, mimeType, durationMs }
}

function parseSoundscapeSource(value: unknown): SoundscapeSourceAsset | null {
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

export function readCompletedSoundscapeMix(input: {
  readonly status: string | null
  readonly mixJson?: unknown
} | null | undefined): SoundscapeMix | null {
  if (!input || input.status !== SOUNDSCAPE_STATUS.COMPLETED) return null
  return parseSoundscapeMix(input.mixJson)
}

export function readSoundscapeTimelineSignature(input: {
  readonly timelineSignature?: string | null
} | null | undefined): string | null {
  const value = input?.timelineSignature
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function readSoundscapeDecision(input: {
  readonly planJson?: unknown
} | null | undefined): 'soundscape' | 'none_needed' | null {
  const planJson = input?.planJson
  if (!isRecord(planJson)) return null
  const decision = planJson.decision
  return decision === 'soundscape' || decision === 'none_needed' ? decision : null
}

export function readSoundscapeSources(value: unknown): SoundscapeSourceAsset[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseSoundscapeSource)
    .filter((source): source is SoundscapeSourceAsset => source !== null)
}

export function readSoundscapeSourcesStrict(value: unknown): SoundscapeSourceAsset[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error('SOUNDSCAPE_SOURCES_JSON_INVALID')
  return value.map((source, index) => {
    const parsed = parseSoundscapeSource(source)
    if (!parsed) throw new Error(`SOUNDSCAPE_SOURCE_JSON_INVALID:${index}`)
    return parsed
  })
}

export async function writeSoundscapeProjectData(input: {
  readonly episodeId: string
  readonly soundscape: SoundscapeProjectData
}): Promise<void> {
  const planJson = input.soundscape.plan
    ? input.soundscape.plan as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull
  const sourcesJson = input.soundscape.sources
    ? input.soundscape.sources as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull
  const mixJson = input.soundscape.mix
    ? input.soundscape.mix as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull
  const diagnosticsJson = input.soundscape.errorMessage
    ? { errorMessage: input.soundscape.errorMessage } as Prisma.InputJsonValue
    : Prisma.JsonNull

  await prisma.projectEditSoundscape.upsert({
    where: { episodeId: input.episodeId },
    create: {
      episodeId: input.episodeId,
      planJson,
      sourcesJson,
      mixJson,
      diagnosticsJson,
      status: input.soundscape.status,
      taskId: input.soundscape.taskId,
      timelineSignature: input.soundscape.timelineSignature,
      soundEffectModel: input.soundscape.soundEffectModel,
    },
    update: {
      planJson,
      sourcesJson,
      mixJson,
      diagnosticsJson,
      status: input.soundscape.status,
      taskId: input.soundscape.taskId,
      timelineSignature: input.soundscape.timelineSignature,
      soundEffectModel: input.soundscape.soundEffectModel,
    },
  })
}
