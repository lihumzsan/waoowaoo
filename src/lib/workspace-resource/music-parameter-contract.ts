export const MUSIC_KEY_SCALE_VALUES = [
  'C major', 'C# major', 'Db major', 'D major', 'D# major', 'Eb major', 'E major', 'F major', 'F# major', 'Gb major', 'G major', 'G# major', 'Ab major', 'A major', 'A# major', 'Bb major', 'B major',
  'C minor', 'C# minor', 'Db minor', 'D minor', 'D# minor', 'Eb minor', 'E minor', 'F minor', 'F# minor', 'Gb minor', 'G minor', 'G# minor', 'Ab minor', 'A minor', 'A# minor', 'Bb minor', 'B minor',
] as const

export const MUSIC_TIME_SIGNATURE_VALUES = ['2', '3', '4', '6'] as const

export type MusicKeyScale = (typeof MUSIC_KEY_SCALE_VALUES)[number]
export type MusicTimeSignature = (typeof MUSIC_TIME_SIGNATURE_VALUES)[number]

export function isMusicKeyScale(value: unknown): value is MusicKeyScale {
  return typeof value === 'string' && (MUSIC_KEY_SCALE_VALUES as readonly string[]).includes(value)
}

export function isMusicTimeSignature(value: unknown): value is MusicTimeSignature {
  return typeof value === 'string' && (MUSIC_TIME_SIGNATURE_VALUES as readonly string[]).includes(value)
}
