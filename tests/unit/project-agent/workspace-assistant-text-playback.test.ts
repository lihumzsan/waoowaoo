import { describe, expect, it } from 'vitest'
import { resolveWorkspaceAssistantTextPlaybackInitialState } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantTextPlayback'

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
})
