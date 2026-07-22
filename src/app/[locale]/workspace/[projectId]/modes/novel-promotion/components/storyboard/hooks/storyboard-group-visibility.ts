import type { NovelPromotionStoryboard } from '@/types/project'

function needsAttention(storyboard: NovelPromotionStoryboard) {
  return Boolean(
    storyboard.lastError
    || storyboard.storyboardTaskRunning
    || (storyboard.panels ?? []).some((panel) => panel.imageTaskRunning || !panel.imageUrl),
  )
}

export function resolveDefaultOpenStoryboardId(storyboards: NovelPromotionStoryboard[]) {
  return storyboards.find(needsAttention)?.id ?? storyboards[0]?.id ?? null
}

export function reconcileOpenStoryboardId(
  currentId: string | null,
  storyboards: NovelPromotionStoryboard[],
) {
  if (currentId === null) return null
  return storyboards.some((storyboard) => storyboard.id === currentId)
    ? currentId
    : resolveDefaultOpenStoryboardId(storyboards)
}

export function toggleOpenStoryboardId(currentId: string | null, targetId: string) {
  return currentId === targetId ? null : targetId
}
