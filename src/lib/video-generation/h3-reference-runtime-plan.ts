import { resolveH3ReferencePreset } from './h3-runtime-policy'
import { resolveH3DurationPlan, type H3DurationPlan } from './h3-duration'

export const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const
export type H3AspectRatio = (typeof H3_ASPECT_RATIOS)[number]

export type H3ReferenceRuntimePlan = H3DurationPlan & {
  readonly firstPassMegapixels: number
  readonly secondPassMegapixels: number
}

export function resolveH3ReferenceRuntimePlan(requestedDurationSeconds: number): H3ReferenceRuntimePlan {
  const durationPlan = resolveH3DurationPlan({ inputMode: 'reference', requestedDurationSeconds })
  return {
    ...durationPlan,
    ...resolveH3ReferencePreset(requestedDurationSeconds),
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
