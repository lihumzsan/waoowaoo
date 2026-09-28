import type { VideoInputMode } from '@/lib/ai-registry/types'

export type H3InputMode = Exclude<VideoInputMode, 'text_to_video'>
export type H3ReferencePreset = Readonly<{
  firstPassMegapixels: number
  secondPassMegapixels: number
}>

const H3_REFERENCE_PRESETS: Readonly<Record<number, H3ReferencePreset>> = {
  4: { firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
  5: { firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
  6: { firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
  7: { firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
  8: { firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
  9: { firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
  10: { firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
  11: { firstPassMegapixels: 0.61, secondPassMegapixels: 0.88 },
  12: { firstPassMegapixels: 0.58, secondPassMegapixels: 0.83 },
  13: { firstPassMegapixels: 0.52, secondPassMegapixels: 0.75 },
  14: { firstPassMegapixels: 0.49, secondPassMegapixels: 0.71 },
  15: { firstPassMegapixels: 0.47, secondPassMegapixels: 0.67 },
  // Experimental RTX 5070 Ti 16GB presets; real GPU validation is pending.
  20: { firstPassMegapixels: 0.35, secondPassMegapixels: 0.50 },
  24: { firstPassMegapixels: 0.29, secondPassMegapixels: 0.42 },
  30: { firstPassMegapixels: 0.23, secondPassMegapixels: 0.33 },
}
const FRAME_MODE_DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const
const H3_DURATION_OPTIONS_BY_MODE: Readonly<Record<H3InputMode, readonly number[]>> = {
  reference: Object.keys(H3_REFERENCE_PRESETS).map(Number),
  first_frame: FRAME_MODE_DURATION_OPTIONS,
  first_last_frame: FRAME_MODE_DURATION_OPTIONS,
  continuation: FRAME_MODE_DURATION_OPTIONS,
}

export function listH3DurationOptions(inputMode: H3InputMode): readonly number[] {
  if (!Object.hasOwn(H3_DURATION_OPTIONS_BY_MODE, inputMode)) {
    throw new Error(`H3_INPUT_MODE_INVALID:${String(inputMode)}`)
  }
  return H3_DURATION_OPTIONS_BY_MODE[inputMode]
}

export function resolveH3ReferencePreset(requestedDurationSeconds: number): H3ReferencePreset {
  if (!Number.isInteger(requestedDurationSeconds) || !Object.hasOwn(H3_REFERENCE_PRESETS, requestedDurationSeconds)) {
    throw new Error(`H3_REFERENCE_DURATION_INVALID:${String(requestedDurationSeconds)}`)
  }
  return H3_REFERENCE_PRESETS[requestedDurationSeconds]
}
