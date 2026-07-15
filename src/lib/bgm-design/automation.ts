import {
  type AutomationLane,
  type BgmDesignClock,
  type BgmPresenceSegment,
} from './types'

const MUTED_GAIN_DB = -120

function setKeyframe(values: Map<number, number>, frame: number, valueDb: number): void {
  values.set(frame, valueDb)
}

export function compileBgmPresenceAutomation(input: {
  readonly presence: readonly BgmPresenceSegment[]
  readonly clock: BgmDesignClock
}): AutomationLane {
  if (input.clock.totalFrames < 2) throw new Error('BGM_PRESENCE_TIMELINE_TOO_SHORT')
  const first = input.presence[0]
  const last = input.presence[input.presence.length - 1]
  if (!first || !last) throw new Error('BGM_PRESENCE_REQUIRED')

  const values = new Map<number, number>()
  setKeyframe(values, 0, first.mode === 'score_on' ? 0 : MUTED_GAIN_DB)
  for (let index = 1; index < input.presence.length; index += 1) {
    const previous = input.presence[index - 1]
    const current = input.presence[index]
    if (!previous || !current || previous.mode === current.mode) continue
    const previousOn = previous.mode === 'score_on'
    const requestedFade = previousOn ? previous.fadeOutFrames : current.fadeInFrames
    const boundary = current.range.startFrame
    const fadeStart = Math.max(previous.range.startFrame, boundary - Math.max(1, requestedFade))
    setKeyframe(values, fadeStart === boundary ? Math.max(0, boundary - 1) : fadeStart, previousOn ? 0 : MUTED_GAIN_DB)
    setKeyframe(values, boundary, current.mode === 'score_on' ? 0 : MUTED_GAIN_DB)
  }
  setKeyframe(values, input.clock.totalFrames - 1, last.mode === 'score_on' ? 0 : MUTED_GAIN_DB)
  const keyframes = [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([frame, valueDb]) => ({ frame, valueDb, interpolation: 'smooth' as const }))
  if (keyframes.length < 2) throw new Error('BGM_PRESENCE_AUTOMATION_INVALID')
  return {
    laneId: 'score_presence',
    targetBus: 'score',
    keyframes,
    postBehavior: 'hold',
    reason: 'deterministic BGM audibility compiled from scorePresence',
  }
}

function format(value: number): string {
  if (!Number.isFinite(value)) throw new Error('BGM_AUTOMATION_NUMBER_INVALID')
  return value.toFixed(6)
}

function laneExpression(lane: AutomationLane, clock: BgmDesignClock, timelineOffsetFrames: number): string {
  const first = lane.keyframes[0]
  const last = lane.keyframes[lane.keyframes.length - 1]
  if (!first || !last) throw new Error(`BGM_AUTOMATION_KEYFRAMES_REQUIRED:${lane.laneId}`)
  const offsetSeconds = timelineOffsetFrames / clock.fps
  const time = offsetSeconds === 0 ? 't' : `(t+${format(offsetSeconds)})`
  let expression = format(lane.postBehavior === 'hold' ? last.valueDb : 0)
  for (let index = lane.keyframes.length - 2; index >= 0; index -= 1) {
    const from = lane.keyframes[index]
    const to = lane.keyframes[index + 1]
    if (!from || !to) throw new Error(`BGM_AUTOMATION_KEYFRAME_MISSING:${lane.laneId}:${index}`)
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
  readonly clock: BgmDesignClock
  readonly timelineOffsetFrames?: number
}): string {
  if (!Number.isFinite(input.baseVolume) || input.baseVolume < 0 || input.baseVolume > 4) {
    throw new Error('BGM_AUTOMATION_BASE_VOLUME_INVALID')
  }
  if (input.lanes.length === 0) return `volume=${format(input.baseVolume)}`
  const offset = input.timelineOffsetFrames ?? 0
  if (!Number.isInteger(offset) || offset < 0) throw new Error('BGM_AUTOMATION_TIMELINE_OFFSET_INVALID')
  const db = input.lanes.map((lane) => `(${laneExpression(lane, input.clock, offset)})`).join('+')
  const expression = `${format(input.baseVolume)}*pow(10,(${db})/20)`.replace(/,/g, '\\,')
  return `volume='${expression}':eval=frame`
}
