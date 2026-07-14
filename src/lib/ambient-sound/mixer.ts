import { buildGainAutomationVolumeFilter } from '@/lib/audio-design/automation'
import { frameToSample, type AcousticPerspective, type AcousticTransition, type AmbienceSource, type AudioDesign, type FrameRange } from '@/lib/audio-design/types'
import type { FinalRenderAudioCommandRunner } from '@/lib/video-compose/final-render-audio'

export type AudioDesignAmbienceTrack = {
  readonly source: AmbienceSource
  readonly path: string
  readonly perspectives: readonly AcousticPerspective[]
  readonly transitions: readonly AcousticTransition[]
}

type Branch = {
  readonly track: AudioDesignAmbienceTrack
  readonly perspective: AcousticPerspective
  readonly range: FrameRange
  readonly incoming?: AcousticTransition
  readonly outgoing?: AcousticTransition
}

function format(value: number): string {
  if (!Number.isFinite(value)) throw new Error('AUDIO_AMBIENCE_FILTER_NUMBER_INVALID')
  return value.toFixed(6)
}

function overlaps(first: FrameRange, second: FrameRange): boolean {
  return first.startFrame < second.endFrameExclusive && second.startFrame < first.endFrameExclusive
}

function buildBranches(tracks: readonly AudioDesignAmbienceTrack[]): Branch[] {
  return tracks.flatMap((track) => track.perspectives.filter((perspective) => overlaps(perspective.range, track.source.range)).map((perspective) => {
    const incoming = track.transitions.find((transition) => transition.toZoneId === perspective.zoneId && overlaps(transition.range, track.source.range))
    const outgoing = track.transitions.find((transition) => transition.fromZoneId === perspective.zoneId && overlaps(transition.range, track.source.range))
    const range = {
      startFrame: Math.max(track.source.range.startFrame, incoming ? Math.min(perspective.range.startFrame, incoming.range.startFrame) : perspective.range.startFrame),
      endFrameExclusive: Math.min(track.source.range.endFrameExclusive, outgoing ? Math.max(perspective.range.endFrameExclusive, outgoing.range.endFrameExclusive) : perspective.range.endFrameExclusive),
    }
    if (range.endFrameExclusive <= range.startFrame) throw new Error(`AUDIO_AMBIENCE_PERSPECTIVE_RANGE_INVALID:${track.source.sourceId}:${perspective.perspectiveId}`)
    return { track, perspective, range, ...(incoming ? { incoming } : {}), ...(outgoing ? { outgoing } : {}) }
  }))
}

function acousticFilters(perspective: AcousticPerspective): readonly string[] {
  const gainDb = (perspective.distance === 'near' ? 0 : perspective.distance === 'medium' ? -2.5 : -6)
    + (perspective.enclosure === 'enclosed' ? -1 : perspective.enclosure === 'semi_open' ? -0.5 : 0)
    - perspective.occlusion * 7
  const cutoff = Math.max(1_200, Math.min(20_000, 20_000 - perspective.occlusion * 14_000 - (perspective.enclosure === 'enclosed' ? 2_500 : perspective.enclosure === 'semi_open' ? 1_000 : 0)))
  const width = Math.max(0.2, Math.min(1, 1 - perspective.occlusion * 0.65 - (perspective.enclosure === 'enclosed' ? 0.15 : 0) - (perspective.distance === 'far' ? 0.1 : 0)))
  const filters = [`volume=${format(10 ** (gainDb / 20))}`, `lowpass=f=${format(cutoff)}`, `stereotools=mlev=1:slev=${format(width)}`]
  if (perspective.enclosure === 'enclosed') filters.push('aecho=0.8:0.35:35|65:0.18|0.10')
  return filters
}

export function buildAudioDesignAmbienceGraph(input: {
  readonly design: AudioDesign
  readonly tracks: readonly AudioDesignAmbienceTrack[]
}): { readonly inputArgs: readonly string[]; readonly filterComplex: string; readonly boundaryFrames: readonly number[] } {
  if (input.tracks.length === 0) throw new Error('AUDIO_AMBIENCE_TRACKS_REQUIRED')
  const branches = buildBranches(input.tracks)
  if (branches.length === 0) throw new Error('AUDIO_AMBIENCE_BRANCHES_REQUIRED')
  const filters: string[] = []
  const labels: string[] = []
  branches.forEach((branch, index) => {
    const source = branch.track.source
    const phaseFrames = source.phaseOffsetFrames + branch.range.startFrame - source.range.startFrame
    const phaseSample = frameToSample(phaseFrames, input.design.clock)
    const durationSamples = frameToSample(branch.range.endFrameExclusive - branch.range.startFrame, input.design.clock)
    const startSample = frameToSample(branch.range.startFrame, input.design.clock)
    const lanes = input.design.automationLanes.filter((lane) => lane.targetBus === 'ambience' && (lane.targetSourceId === null || lane.targetSourceId === source.sourceId))
    const fadeFilters: string[] = []
    if (branch.incoming) fadeFilters.push(`afade=t=in:st=0:d=${format((branch.incoming.range.endFrameExclusive - branch.incoming.range.startFrame) / input.design.clock.fps)}:curve=qsin`)
    if (branch.outgoing) fadeFilters.push(`afade=t=out:st=${format((branch.outgoing.range.startFrame - branch.range.startFrame) / input.design.clock.fps)}:d=${format((branch.outgoing.range.endFrameExclusive - branch.outgoing.range.startFrame) / input.design.clock.fps)}:curve=qsin`)
    const label = `amb_${index}`
    labels.push(`[${label}]`)
    filters.push([
      `[${index}:a]atrim=start_sample=${phaseSample}:end_sample=${phaseSample + durationSamples},asetpts=PTS-STARTPTS`,
      'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo',
      `volume=${format(10 ** (source.baseGainDb / 20))}`,
      ...acousticFilters(branch.perspective),
      buildGainAutomationVolumeFilter({ baseVolume: 1, lanes, clock: input.design.clock, timelineOffsetFrames: branch.range.startFrame }),
      ...fadeFilters,
      `adelay=${startSample}S:all=1[${label}]`,
    ].join(','))
  })
  const totalSamples = frameToSample(input.design.clock.totalFrames, input.design.clock)
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,atrim=end_sample=${totalSamples},asetpts=PTS-STARTPTS,loudnorm=I=-24:TP=-3:LRA=18,alimiter=limit=0.90[aout]`)
  return {
    inputArgs: branches.flatMap((branch) => branch.track.source.playbackType === 'seamless_loop' || branch.track.source.playbackType === 'continuous_evolving'
      ? ['-stream_loop', '-1', '-i', branch.track.path]
      : ['-i', branch.track.path]),
    filterComplex: filters.join(';'),
    boundaryFrames: input.design.soundWorlds.slice(1).map((world) => world.range.startFrame),
  }
}

export async function renderAudioDesignAmbienceMix(input: {
  readonly runCommand: FinalRenderAudioCommandRunner
  readonly design: AudioDesign
  readonly tracks: readonly AudioDesignAmbienceTrack[]
  readonly outputPath: string
}): Promise<readonly number[]> {
  const graph = buildAudioDesignAmbienceGraph({ design: input.design, tracks: input.tracks })
  await input.runCommand('ffmpeg', [
    '-y', ...graph.inputArgs, '-filter_complex', graph.filterComplex, '-map', '[aout]',
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2', '-t', (input.design.clock.totalFrames / input.design.clock.fps).toFixed(6), input.outputPath,
  ])
  return graph.boundaryFrames
}
