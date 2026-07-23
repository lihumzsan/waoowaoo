import type { NovelPromotionStoryboard } from '@/types/project'

export interface OpenStoryboardState {
  episodeId: string
  storyboardId: string | null
  isInitialized: boolean
}

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

export function createUninitializedOpenStoryboardState(episodeId: string): OpenStoryboardState {
  return {
    episodeId,
    storyboardId: null,
    isInitialized: false,
  }
}

export function reconcileOpenStoryboardState(
  currentState: OpenStoryboardState,
  episodeId: string,
  storyboards: NovelPromotionStoryboard[],
  isInitialTaskStatePending: boolean,
): OpenStoryboardState {
  const state = currentState.episodeId === episodeId
    ? currentState
    : createUninitializedOpenStoryboardState(episodeId)

  if (state.isInitialized) {
    const storyboardId = reconcileOpenStoryboardId(state.storyboardId, storyboards)
    return storyboardId === state.storyboardId
      ? state
      : { ...state, storyboardId }
  }

  if (storyboards.length === 0 || isInitialTaskStatePending) return state

  return {
    ...state,
    storyboardId: resolveDefaultOpenStoryboardId(storyboards),
    isInitialized: true,
  }
}

export function toggleOpenStoryboardState(
  currentState: OpenStoryboardState,
  episodeId: string,
  targetId: string,
): OpenStoryboardState {
  const state = currentState.episodeId === episodeId
    ? currentState
    : createUninitializedOpenStoryboardState(episodeId)

  return {
    ...state,
    storyboardId: toggleOpenStoryboardId(state.storyboardId, targetId),
    isInitialized: true,
  }
}
