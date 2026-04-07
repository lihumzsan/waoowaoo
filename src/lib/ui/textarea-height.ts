export const HOME_QUICK_START_MIN_ROWS = 3
export const PROJECT_STORY_INPUT_MIN_ROWS = 8

interface ResolveTextareaTargetHeightInput {
  minHeight: number
  maxHeight: number
  scrollHeight: number
}

export function resolveTextareaTargetHeight(
  input: ResolveTextareaTargetHeightInput,
): number {
  const cappedHeight = Math.min(input.scrollHeight, input.maxHeight)
  return Math.max(input.minHeight, cappedHeight)
}
