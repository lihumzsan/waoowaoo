import { resolveH3DurationPlan } from './h3-duration'

export const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const
export type H3AspectRatio = (typeof H3_ASPECT_RATIOS)[number]

const H3_REFERENCE_PASS_MEGAPIXELS = {
  5: [0.70, 1.00], 6: [0.70, 1.00], 7: [0.70, 1.00], 8: [0.70, 1.00],
  9: [0.70, 1.00], 10: [0.70, 1.00], 11: [0.61, 0.88], 12: [0.58, 0.83],
  13: [0.52, 0.75], 14: [0.49, 0.71], 15: [0.47, 0.67],
} as const

export type H3ReferenceRuntimePlan = {
  readonly requestedDurationSeconds: number
  readonly frameCount: number
  readonly promptEndSeconds: number
  readonly firstPassMegapixels: number
  readonly secondPassMegapixels: number
}

export function resolveH3ReferenceRuntimePlan(requestedDurationSeconds: number): H3ReferenceRuntimePlan {
  const durationPlan = resolveH3DurationPlan({ inputMode: 'reference', requestedDurationSeconds })
  const passMegapixels = H3_REFERENCE_PASS_MEGAPIXELS[requestedDurationSeconds as keyof typeof H3_REFERENCE_PASS_MEGAPIXELS]
  if (!passMegapixels) throw new Error(`H3_REFERENCE_DURATION_INVALID:${String(requestedDurationSeconds)}`)
  return {
    ...durationPlan,
    firstPassMegapixels: passMegapixels[0],
    secondPassMegapixels: passMegapixels[1],
  }
}

function roundToMultiple(value: number): number {
  return Math.max(32, Math.round(value / 32) * 32)
}

export function resolveH3ReferenceDimensions(input: {
  readonly aspectRatio: H3AspectRatio
  readonly megapixels: number
}): { readonly width: number; readonly height: number } {
  if (!(H3_ASPECT_RATIOS as readonly string[]).includes(input.aspectRatio)) {
    throw new Error(`H3_ASPECT_RATIO_INVALID:${input.aspectRatio}`)
  }
  if (!Number.isFinite(input.megapixels) || input.megapixels <= 0) {
    throw new Error(`H3_MEGAPIXELS_INVALID:${String(input.megapixels)}`)
  }
  const [ratioWidth, ratioHeight] = input.aspectRatio.split(':').map(Number)
  if (!ratioWidth || !ratioHeight) throw new Error(`H3_ASPECT_RATIO_INVALID:${input.aspectRatio}`)
  const scale = Math.sqrt((input.megapixels * 1024 * 1024) / (ratioWidth * ratioHeight))
  return {
    width: roundToMultiple(ratioWidth * scale),
    height: roundToMultiple(ratioHeight * scale),
  }
}
