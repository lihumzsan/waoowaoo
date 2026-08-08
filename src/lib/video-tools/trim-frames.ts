export const VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES = 100_000

export function isValidVideoTrimFrames(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES
}
