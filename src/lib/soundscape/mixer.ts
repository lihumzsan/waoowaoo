import type { FinalRenderAudioCommandRunner } from '@/lib/video-compose/final-render-audio'
import type {
  SoundscapeIntensity,
  SoundscapePerspective,
  SoundscapeSourceAsset,
  SoundscapeTransition,
} from './types'
import type { SoundscapeResolvedSection } from './timeline'

export const SOUNDSCAPE_AUDIO_TARGET_LUFS = -24
export const SOUNDSCAPE_TRANSITION_SECONDS = 0.75

const PERSPECTIVE_DSP: Record<SoundscapePerspective, {
  readonly gainDb: number
  readonly lowpassHz: number
  readonly stereoWidth: number
}> = {
  exterior_near: { gainDb: 0, lowpassHz: 16000, stereoWidth: 1 },
  exterior_far: { gainDb: -8, lowpassHz: 9000, stereoWidth: 0.8 },
  interior: { gainDb: -16, lowpassHz: 3500, stereoWidth: 0.55 },
  interior_behind_window: { gainDb: -22, lowpassHz: 2200, stereoWidth: 0.4 },
}

const INTENSITY_GAIN_DB: Record<SoundscapeIntensity, number> = {
  low: -8,
  medium: 0,
  high: 4,
}

function formatFilterNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('SOUNDSCAPE_FILTER_NUMBER_INVALID')
  return value.toFixed(3)
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

function delayFilter(startSeconds: number): string {
  const delayMs = Math.max(0, Math.round(startSeconds * 1000))
  return `adelay=${delayMs}|${delayMs}`
}

function transitionDuration(transition: SoundscapeTransition): number {
  return transition === 'cut' ? 0 : SOUNDSCAPE_TRANSITION_SECONDS
}

function buildFadeFilters(section: SoundscapeResolvedSection): string[] {
  const fadeInSeconds = transitionDuration(section.section.transitionIn)
  const fadeOutSeconds = transitionDuration(section.section.transitionOut)
  if (fadeInSeconds + fadeOutSeconds >= section.durationSeconds) {
    throw new Error(`SOUNDSCAPE_SECTION_TRANSITION_TOO_LONG:${section.section.fromShotId}:${section.section.toShotId}`)
  }
  const filters: string[] = []
  if (fadeInSeconds > 0) {
    filters.push(`afade=t=in:st=0:d=${formatFilterNumber(fadeInSeconds)}`)
  }
  if (fadeOutSeconds > 0) {
    filters.push(`afade=t=out:st=${formatFilterNumber(section.durationSeconds - fadeOutSeconds)}:d=${formatFilterNumber(fadeOutSeconds)}`)
  }
  return filters
}

export function buildSoundscapeSectionDspFilters(section: SoundscapeResolvedSection): string[] {
  const perspective = PERSPECTIVE_DSP[section.section.perspective]
  const gainDb = perspective.gainDb + INTENSITY_GAIN_DB[section.section.intensity]
  return [
    `volume=${formatFilterNumber(dbToLinear(gainDb))}`,
    `lowpass=f=${perspective.lowpassHz}`,
    `stereotools=slev=${formatFilterNumber(perspective.stereoWidth)}`,
    ...buildFadeFilters(section),
  ]
}

function sourceKey(source: Pick<SoundscapeSourceAsset, 'sourceId'>): string {
  return source.sourceId
}

function buildSourceMaps(input: {
  readonly sources: readonly SoundscapeSourceAsset[]
  readonly sections: readonly SoundscapeResolvedSection[]
}): {
  readonly sourceById: ReadonlyMap<string, SoundscapeSourceAsset>
  readonly sourceInputIndexById: ReadonlyMap<string, number>
  readonly sectionSourceOrdinalByIndex: ReadonlyMap<number, number>
  readonly sectionCountBySourceId: ReadonlyMap<string, number>
} {
  const sourceById = new Map(input.sources.map((source) => [sourceKey(source), source]))
  const sourceInputIndexById = new Map<string, number>()
  input.sources.forEach((source, index) => sourceInputIndexById.set(sourceKey(source), index))

  const counters = new Map<string, number>()
  const sectionSourceOrdinalByIndex = new Map<number, number>()
  for (const section of input.sections) {
    const id = section.section.sourceId
    if (!sourceById.has(id)) throw new Error(`SOUNDSCAPE_SECTION_SOURCE_MISSING:${id}`)
    const next = counters.get(id) ?? 0
    sectionSourceOrdinalByIndex.set(section.index, next)
    counters.set(id, next + 1)
  }

  return {
    sourceById,
    sourceInputIndexById,
    sectionSourceOrdinalByIndex,
    sectionCountBySourceId: counters,
  }
}

export function buildSoundscapeFilterComplex(input: {
  readonly sources: readonly SoundscapeSourceAsset[]
  readonly sections: readonly SoundscapeResolvedSection[]
  readonly durationSeconds: number
}): string {
  if (input.sources.length === 0) throw new Error('SOUNDSCAPE_MIX_SOURCES_EMPTY')
  if (input.sections.length === 0) throw new Error('SOUNDSCAPE_MIX_SECTIONS_EMPTY')
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('SOUNDSCAPE_MIX_DURATION_INVALID')
  }

  const maps = buildSourceMaps(input)
  const filters: string[] = []
  for (const [sourceIndex, source] of input.sources.entries()) {
    const count = maps.sectionCountBySourceId.get(source.sourceId) ?? 0
    if (count === 0) continue
    const base = `[${sourceIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${formatFilterNumber(input.durationSeconds)},asetpts=PTS-STARTPTS`
    if (count === 1) {
      filters.push(`${base}[src${sourceIndex}_0]`)
    } else {
      const outputs = Array.from({ length: count }, (_, ordinal) => `[src${sourceIndex}_${ordinal}]`).join('')
      filters.push(`${base},asplit=${count}${outputs}`)
    }
  }

  const sectionLabels: string[] = []
  for (const section of input.sections) {
    const sourceIndex = maps.sourceInputIndexById.get(section.section.sourceId)
    const sourceOrdinal = maps.sectionSourceOrdinalByIndex.get(section.index)
    if (sourceIndex === undefined || sourceOrdinal === undefined) {
      throw new Error(`SOUNDSCAPE_SECTION_SOURCE_RESOLUTION_FAILED:${section.section.sourceId}`)
    }
    const label = `sec${section.index}`
    sectionLabels.push(`[${label}]`)
    const sectionFilters = [
      `atrim=start=${formatFilterNumber(section.startSeconds)}:end=${formatFilterNumber(section.endSeconds)}`,
      'asetpts=PTS-STARTPTS',
      ...buildSoundscapeSectionDspFilters(section),
      delayFilter(section.startSeconds),
    ].join(',')
    filters.push(`[src${sourceIndex}_${sourceOrdinal}]${sectionFilters}[${label}]`)
  }

  const mixFilters = [
    `amix=inputs=${sectionLabels.length}:duration=longest:dropout_transition=0`,
    `atrim=0:${formatFilterNumber(input.durationSeconds)}`,
    'asetpts=PTS-STARTPTS',
    `loudnorm=I=${SOUNDSCAPE_AUDIO_TARGET_LUFS}:TP=-2:LRA=11`,
    'alimiter=limit=0.95',
  ].join(',')
  filters.push(`${sectionLabels.join('')}${mixFilters}[aout]`)
  return filters.join(';')
}

export async function renderSoundscapeMix(input: {
  readonly runCommand: FinalRenderAudioCommandRunner
  readonly sourcePaths: readonly string[]
  readonly sources: readonly SoundscapeSourceAsset[]
  readonly sections: readonly SoundscapeResolvedSection[]
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  if (input.sourcePaths.length !== input.sources.length) {
    throw new Error('SOUNDSCAPE_MIX_SOURCE_PATH_COUNT_INVALID')
  }
  const sourceInputs = input.sourcePaths.flatMap((sourcePath) => ['-stream_loop', '-1', '-i', sourcePath])
  await input.runCommand('ffmpeg', [
    '-y',
    ...sourceInputs,
    '-filter_complex',
    buildSoundscapeFilterComplex({
      sources: input.sources,
      sections: input.sections,
      durationSeconds: input.durationSeconds,
    }),
    '-map',
    '[aout]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    input.outputPath,
  ])
}
