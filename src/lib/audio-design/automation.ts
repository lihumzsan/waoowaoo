import {
  type AudioDesignClock,
  type AutomationLane,
  type SoundPresenceMode,
  type SoundPresenceSegment,
  soundPresenceUsesAmbience,
  soundPresenceUsesScore,
} from './types'

const MUTED_GAIN_DB = -120

function modeUsesBus(mode: SoundPresenceMode, bus: 'ambience' | 'score'): boolean {
  return bus === 'ambience' ? soundPresenceUsesAmbience(mode) : soundPresenceUsesScore(mode)
}

function setKeyframe(values: Map<number, number>, frame: number, valueDb: number): void {
  values.set(frame, valueDb)
}

function buildPresenceLane(input: {
  readonly presence: readonly SoundPresenceSegment[]
  readonly clock: AudioDesignClock
  readonly bus: 'ambience' | 'score'
}): AutomationLane {
  if (input.clock.totalFrames < 2) throw new Error('AUDIO_SOUND_PRESENCE_TIMELINE_TOO_SHORT')
  const values = new Map<number, number>()
  const first = input.presence[0]
  const last = input.presence[input.presence.length - 1]
  if (!first || !last) throw new Error('AUDIO_SOUND_PRESENCE_REQUIRED')
  setKeyframe(values, 0, modeUsesBus(first.mode, input.bus) ? 0 : MUTED_GAIN_DB)

  for (let index = 1; index < input.presence.length; index += 1) {
    const previous = input.presence[index - 1]
    const current = input.presence[index]
    if (!previous || !current) continue
    const previousOn = modeUsesBus(previous.mode, input.bus)
    const currentOn = modeUsesBus(current.mode, input.bus)
    if (previousOn === currentOn) continue
    const requestedFade = previousOn ? previous.fadeOutFrames : current.fadeInFrames
    const fadeFrames = Math.max(1, requestedFade)
    const boundary = current.range.startFrame
    const fadeStart = Math.max(previous.range.startFrame, boundary - fadeFrames)
    if (fadeStart === boundary) {
      setKeyframe(values, Math.max(0, boundary - 1), previousOn ? 0 : MUTED_GAIN_DB)
    } else {
      setKeyframe(values, fadeStart, previousOn ? 0 : MUTED_GAIN_DB)
    }
    setKeyframe(values, boundary, currentOn ? 0 : MUTED_GAIN_DB)
  }

  setKeyframe(values, input.clock.totalFrames - 1, modeUsesBus(last.mode, input.bus) ? 0 : MUTED_GAIN_DB)
  const keyframes = [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([frame, valueDb]) => ({ frame, valueDb, interpolation: 'smooth' as const }))
  if (keyframes.length < 2) throw new Error(`AUDIO_SOUND_PRESENCE_AUTOMATION_INVALID:${input.bus}`)
  return {
    laneId: `${input.bus}_sound_presence`,
    targetBus: input.bus,
    targetSourceId: null,
    keyframes,
    postBehavior: 'hold',
    reason: `deterministic ${input.bus} audibility compiled from SoundPresence`,
    sourceEventId: null,
  }
}

export function compileSoundPresenceAutomation(input: {
  readonly presence: readonly SoundPresenceSegment[]
  readonly clock: AudioDesignClock
}): readonly AutomationLane[] {
  return [
    buildPresenceLane({ ...input, bus: 'ambience' }),
    buildPresenceLane({ ...input, bus: 'score' }),
  ]
}

function format(value: number): string {
  if (!Number.isFinite(value)) throw new Error('AUDIO_AUTOMATION_NUMBER_INVALID')
  return value.toFixed(6)
}

function laneExpression(lane: AutomationLane, clock: AudioDesignClock, timelineOffsetFrames: number): string {
  const first = lane.keyframes[0]
  const last = lane.keyframes[lane.keyframes.length - 1]
  if (!first || !last) throw new Error(`AUDIO_AUTOMATION_KEYFRAMES_REQUIRED:${lane.laneId}`)
  const offsetSeconds = timelineOffsetFrames / clock.fps
  const time = offsetSeconds === 0 ? 't' : `(t+${format(offsetSeconds)})`
  let expression = format(lane.postBehavior === 'hold' ? last.valueDb : 0)
  for (let index = lane.keyframes.length - 2; index >= 0; index -= 1) {
    const from = lane.keyframes[index]
    const to = lane.keyframes[index + 1]
    if (!from || !to) throw new Error(`AUDIO_AUTOMATION_KEYFRAME_MISSING:${lane.laneId}:${index}`)
    const fromTime = from.frame / clock.fps
    const toTime = to.frame / clock.fps
    const progress = `((${time}-${format(fromTime)})/${format(toTime - fromTime)})`
    const delta = to.valueDb - from.valueDb
    const curve = to.interpolation === 'linear'
      ? progress
      : to.interpolation === 'equal_power'
        ? `(sin(PI/2*${progress})*sin(PI/2*${progress}))`
        : `(${progress}*${progress}*(3-2*${progress}))`
    const interpolated = `(${format(from.valueDb)}+${format(delta)}*${curve})`
    expression = `if(lt(${time},${format(toTime)}),${interpolated},${expression})`
  }
  return `if(lt(${time},${format(first.frame / clock.fps)}),0,${expression})`
}

export function buildGainAutomationVolumeFilter(input: {
  readonly baseVolume: number
  readonly lanes: readonly AutomationLane[]
  readonly clock: AudioDesignClock
  readonly timelineOffsetFrames?: number
}): string {
  if (!Number.isFinite(input.baseVolume) || input.baseVolume < 0 || input.baseVolume > 4) {
    throw new Error('AUDIO_AUTOMATION_BASE_VOLUME_INVALID')
  }
  if (input.lanes.length === 0) return `volume=${format(input.baseVolume)}`
  const offset = input.timelineOffsetFrames ?? 0
  if (!Number.isInteger(offset) || offset < 0) throw new Error('AUDIO_AUTOMATION_TIMELINE_OFFSET_INVALID')
  const db = input.lanes.map((lane) => `(${laneExpression(lane, input.clock, offset)})`).join('+')
  const expression = `${format(input.baseVolume)}*pow(10,(${db})/20)`.replace(/,/g, '\\,')
  return `volume='${expression}':eval=frame`
}
