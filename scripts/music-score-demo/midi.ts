import type { CompiledScore, InstrumentId } from './types'

const TICKS_PER_BEAT = 480

const instrumentPrograms: Readonly<Record<InstrumentId, number>> = {
  felt_piano: 0,
  warm_pad: 89,
  soft_bass: 38,
  cello: 42,
  glass_mallet: 10,
  soft_pulse: 118,
  concert_grand: 0,
  string_ensemble: 48,
  solo_cello: 42,
  clarinet: 71,
  french_horn: 60,
  harp: 46,
  choir_aahs: 52,
  timpani: 47,
  shakuhachi: 77,
  koto: 107,
  shamisen: 106,
  taiko: 116,
  woodblock: 115,
  tubular_bells: 14,
  contrabass: 43,
  bassoon: 70,
  choir_oohs: 53,
  dulcimer: 15,
  string_tremolo: 44,
  guqin: 107,
  xiao: 77,
  ritual_gong: 14,
  temple_drum: 116,
  low_string_drone: 43,
}

function midiValue(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

function variableLength(value: number): number[] {
  let buffer = value & 0x7f
  const bytes: number[] = []
  while ((value >>= 7) > 0) {
    buffer <<= 8
    buffer |= (value & 0x7f) | 0x80
  }
  while (true) {
    bytes.push(buffer & 0xff)
    if (buffer & 0x80) buffer >>= 8
    else break
  }
  return bytes
}

function chunk(name: string, body: readonly number[]): Buffer {
  const header = Buffer.alloc(8)
  header.write(name, 0)
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, Buffer.from(body)])
}

type MidiEvent = {
  readonly tick: number
  readonly priority: number
  readonly bytes: readonly number[]
}

export function scoreToMidi(score: CompiledScore): Buffer {
  const instruments = [...new Set(score.events.map((event) => event.instrument))]
  const channelByInstrument = new Map<InstrumentId, number>()
  let nextChannel = 0
  for (const instrument of instruments) {
    if (nextChannel === 9) nextChannel += 1
    if (nextChannel > 15) throw new Error('MIDI_CHANNEL_CAPACITY_EXCEEDED')
    channelByInstrument.set(instrument, nextChannel)
    nextChannel += 1
  }
  const events: MidiEvent[] = []
  const microsecondsPerBeat = Math.round(60_000_000 / score.bpm)
  events.push({
    tick: 0,
    priority: 0,
    bytes: [0xff, 0x51, 0x03, (microsecondsPerBeat >> 16) & 0xff, (microsecondsPerBeat >> 8) & 0xff, microsecondsPerBeat & 0xff],
  })
  for (const instrument of instruments) {
    const channel = channelByInstrument.get(instrument)
    if (channel === undefined) throw new Error(`MIDI_CHANNEL_MISSING:${instrument}`)
    events.push({ tick: 0, priority: 1, bytes: [0xc0 | channel, instrumentPrograms[instrument]] })
    const instrumentEvents = score.events.filter((event) => event.instrument === instrument)
    const maximumGain = Math.max(...instrumentEvents.map((event) => event.gain), 0.1)
    const averagePan = instrumentEvents.reduce((sum, event) => sum + event.pan, 0) / Math.max(1, instrumentEvents.length)
    events.push({ tick: 0, priority: 1, bytes: [0xb0 | channel, 7, midiValue(Math.sqrt(maximumGain) * 108)] })
    events.push({ tick: 0, priority: 1, bytes: [0xb0 | channel, 10, midiValue(64 + averagePan * 48)] })
    const isPercussion = instrument === 'timpani'
      || instrument === 'taiko'
      || instrument === 'woodblock'
      || instrument === 'ritual_gong'
      || instrument === 'temple_drum'
    const isAtmospheric = instrument === 'string_ensemble'
      || instrument === 'choir_aahs'
      || instrument === 'choir_oohs'
      || instrument === 'string_tremolo'
      || instrument === 'shakuhachi'
      || instrument === 'xiao'
      || instrument === 'low_string_drone'
    events.push({ tick: 0, priority: 1, bytes: [0xb0 | channel, 91, isPercussion ? 44 : 74] })
    events.push({ tick: 0, priority: 1, bytes: [0xb0 | channel, 93, isAtmospheric ? 38 : 18] })
  }
  for (const event of score.events) {
    const channel = channelByInstrument.get(event.instrument)
    if (channel === undefined) throw new Error(`MIDI_CHANNEL_MISSING:${event.instrument}`)
    const startTick = Math.round(event.startBeat * TICKS_PER_BEAT)
    const endTick = Math.round((event.startBeat + event.durationBeats) * TICKS_PER_BEAT)
    events.push({ tick: startTick, priority: 3, bytes: [0x90 | channel, event.midi, event.velocity] })
    events.push({ tick: endTick, priority: 2, bytes: [0x80 | channel, event.midi, 0] })
  }
  events.sort((left, right) => left.tick - right.tick || left.priority - right.priority)
  const track: number[] = []
  let previousTick = 0
  for (const event of events) {
    track.push(...variableLength(event.tick - previousTick), ...event.bytes)
    previousTick = event.tick
  }
  const totalTicks = Math.round(score.durationSeconds / (60 / score.bpm) * TICKS_PER_BEAT)
  if (previousTick > totalTicks) throw new Error('MIDI_EVENT_EXCEEDS_SCORE_DURATION')
  track.push(...variableLength(totalTicks - previousTick), 0xff, 0x2f, 0x00)

  const header = Buffer.alloc(6)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(1, 2)
  header.writeUInt16BE(TICKS_PER_BEAT, 4)
  return Buffer.concat([chunk('MThd', [...header]), chunk('MTrk', track)])
}
