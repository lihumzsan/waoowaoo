import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantTextPlaybackInitialState,
  resolveWorkspaceAssistantTextPlaybackTick,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantTextPlayback'

describe('Workspace Assistant text playback remounts', () => {
  it('shows the complete current snapshot when a growing stream remounts', () => {
    expect(resolveWorkspaceAssistantTextPlaybackInitialState({
      sourceText: 'The reasoning continues with newly streamed text.',
      targetLength: 48,
      running: true,
      checkpoint: {
        sourceText: 'The reasoning continues',
        displayedCount: 18,
        started: true,
        streamed: true,
      },
    })).toEqual({
      displayedCount: 48,
      started: true,
      streamed: true,
    })
  })

  it('shows the complete current snapshot when a different stream mounts', () => {
    expect(resolveWorkspaceAssistantTextPlaybackInitialState({
      sourceText: 'A different reasoning stream.',
      targetLength: 29,
      running: true,
      checkpoint: {
        sourceText: 'The previous reasoning stream.',
        displayedCount: 18,
        started: true,
        streamed: true,
      },
    })).toEqual({
      displayedCount: 29,
      started: true,
      streamed: true,
    })
  })

  it('advances against the latest growing target without waiting for a stream pause', () => {
    let displayedCount = 12
    for (const targetLength of [20, 30, 42, 56]) {
      const tick = resolveWorkspaceAssistantTextPlaybackTick({
        displayedCount,
        targetLength,
        running: true,
      })
      expect(tick.nextDisplayedCount).toBeGreaterThan(displayedCount)
      expect(tick.continuePlayback).toBe(true)
      displayedCount = tick.nextDisplayedCount
    }
  })

  it('drains a terminal backlog and then stops its clock', () => {
    let displayedCount = 0
    let tickCount = 0
    while (displayedCount < 120 && tickCount < 120) {
      const tick = resolveWorkspaceAssistantTextPlaybackTick({
        displayedCount,
        targetLength: 120,
        running: false,
      })
      displayedCount = tick.nextDisplayedCount
      tickCount += 1
    }
    expect(displayedCount).toBe(120)
    expect(tickCount).toBeLessThanOrEqual(120)
    expect(resolveWorkspaceAssistantTextPlaybackTick({
      displayedCount,
      targetLength: 120,
      running: false,
    }).continuePlayback).toBe(false)
  })
})
