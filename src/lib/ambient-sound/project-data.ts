import {
  AMBIENT_SOUND_STATUS,
  type AmbientSoundMix,
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
  const sourceContinuityId = readString(value, 'sourceContinuityId')
  const prompt = readString(value, 'prompt')
  const mediaId = readString(value, 'mediaId')
  const url = readString(value, 'url')
  const storageKey = readString(value, 'storageKey')
  const mimeType = readString(value, 'mimeType')
  const durationMs = readNumber(value, 'durationMs')
  const loopDurationSeconds = readNumber(value, 'loopDurationSeconds')
  const promptInfluence = readNumber(value, 'promptInfluence')
  const soundEffectModel = readString(value, 'soundEffectModel')
  const candidateIndex = readNumber(value, 'candidateIndex')
  const selected = value.selected
  const range = value.range
  const loop = value.loop
  const crossfadeFrames = readNumber(value, 'crossfadeFrames')
  const phaseOffsetFrames = readNumber(value, 'phaseOffsetFrames')
  const boundaryScore = readNumber(value, 'boundaryScore')
  const quality = value.quality
  if (
    !sourceId ||
    !sourceContinuityId ||
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
    !soundEffectModel ||
    (candidateIndex !== 0 && candidateIndex !== 1) ||
    typeof selected !== 'boolean' ||
    !isRecord(range) ||
    typeof loop !== 'boolean' ||
    crossfadeFrames === null ||
    phaseOffsetFrames === null ||
    boundaryScore === null ||
    !isRecord(quality)
  ) {
    return null
  }
  return {
    sourceId,
    sourceContinuityId,
    candidateIndex,
    selected,
    prompt,
    mediaId,
    url,
    storageKey,
    mimeType,
    durationMs,
    loopDurationSeconds,
    promptInfluence,
    soundEffectModel,
    range: range as unknown as AmbientSoundSourceAsset['range'],
    loop,
    crossfadeFrames,
    phaseOffsetFrames,
    boundaryScore,
    quality: quality as unknown as AmbientSoundSourceAsset['quality'],
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
