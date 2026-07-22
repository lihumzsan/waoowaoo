import { describe, expect, it } from 'vitest'
import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import {
  reconcileOpenStoryboardId,
  resolveDefaultOpenStoryboardId,
  toggleOpenStoryboardId,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/storyboard-group-visibility'

function panel(id: string, imageUrl: string | null, imageTaskRunning = false) {
  return { id, imageUrl, imageTaskRunning } as NovelPromotionPanel
}

function storyboard(
  id: string,
  overrides: Partial<NovelPromotionStoryboard> = {},
): NovelPromotionStoryboard {
  return {
    id,
    episodeId: 'episode-1',
    clipId: `clip-${id}`,
    storyboardTextJson: null,
    panelCount: 0,
    storyboardImageUrl: null,
    panels: [],
    ...overrides,
  }
}

describe('storyboard group visibility', () => {
  it('opens the first group needing attention before complete groups', () => {
    const groups = [
      storyboard('complete', { panels: [panel('p1', '/p1.webp')] }),
      storyboard('missing', { panels: [panel('p2', null)] }),
      storyboard('running', { storyboardTaskRunning: true }),
    ]

    expect(resolveDefaultOpenStoryboardId(groups)).toBe('missing')
  })

  it('treats errors and running panel tasks as attention states', () => {
    expect(resolveDefaultOpenStoryboardId([
      storyboard('complete'),
      storyboard('error', { lastError: 'failed' }),
    ])).toBe('error')
    expect(resolveDefaultOpenStoryboardId([
      storyboard('complete'),
      storyboard('running-panel', { panels: [panel('p2', '/p2.webp', true)] }),
    ])).toBe('running-panel')
  })

  it('falls back to the first group and returns null for an empty collection', () => {
    expect(resolveDefaultOpenStoryboardId([storyboard('first'), storyboard('second')])).toBe('first')
    expect(resolveDefaultOpenStoryboardId([])).toBeNull()
  })

  it('preserves a valid selection across task-state changes', () => {
    expect(reconcileOpenStoryboardId('second', [
      storyboard('first', { lastError: 'new error' }),
      storyboard('second'),
    ])).toBe('second')
  })

  it('preserves an explicit collapsed-all state and replaces a deleted selection', () => {
    const groups = [storyboard('first'), storyboard('second')]
    expect(reconcileOpenStoryboardId(null, groups)).toBeNull()
    expect(reconcileOpenStoryboardId('deleted', groups)).toBe('first')
  })

  it('opens, switches, and collapses one active group', () => {
    expect(toggleOpenStoryboardId(null, 'first')).toBe('first')
    expect(toggleOpenStoryboardId('first', 'second')).toBe('second')
    expect(toggleOpenStoryboardId('second', 'second')).toBeNull()
  })
})
