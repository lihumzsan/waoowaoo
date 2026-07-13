import { describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
  }
})

import { useVideoPanelsProjection } from '@/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelsProjection'

describe('video panels projection error code', () => {
  it('projects failed task lastError code/message onto panel fields', () => {
    const result = useVideoPanelsProjection({
      clips: [{ id: 'clip-1', start: 0, end: 5, summary: 'clip' }],
      storyboards: [{
        id: 'sb-1',
        clipId: 'clip-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          description: 'panel',
        }],
      }],
      panelVideoStates: {
        getTaskState: () => ({
          phase: 'failed',
          lastError: {
            code: 'EXTERNAL_ERROR',
            message: 'upstream failed',
          },
        }),
      },
      panelLipStates: {
        getTaskState: () => null,
      },
    })

    expect(result.allPanels).toHaveLength(1)
    expect(result.allPanels[0]?.videoErrorCode).toBe('EXTERNAL_ERROR')
    expect(result.allPanels[0]?.videoErrorMessage).toBe('upstream failed')
  })

  it('preserves queued phase separately from processing', () => {
    const result = useVideoPanelsProjection({
      clips: [{ id: 'clip-1', start: 0, end: 5, summary: 'clip' }],
      storyboards: [{
        id: 'sb-1',
        clipId: 'clip-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          description: 'panel',
        }],
      }],
      panelVideoStates: {
        getTaskState: () => ({
          phase: 'queued',
          lastError: null,
        }),
      },
      panelLipStates: {
        getTaskState: () => null,
      },
    })

    expect(result.allPanels[0]?.videoTaskRunning).toBe(true)
    expect(result.allPanels[0]?.videoTaskPhase).toBe('queued')
  })

  it('projects previous video availability onto panel fields', () => {
    const result = useVideoPanelsProjection({
      clips: [{ id: 'clip-1', start: 0, end: 5, summary: 'clip' }],
      storyboards: [{
        id: 'sb-1',
        clipId: 'clip-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          description: 'panel',
          hasPreviousVideoVersion: true,
        }],
      }],
      panelVideoStates: {
        getTaskState: () => null,
      },
      panelLipStates: {
        getTaskState: () => null,
      },
    })

    expect(result.allPanels[0]?.hasPreviousVideoVersion).toBe(true)
  })

  it('projects persisted prompt edit flags onto video panels', () => {
    const result = useVideoPanelsProjection({
      clips: [{ id: 'clip-1', start: 0, end: 5, summary: 'clip' }],
      storyboards: [{
        id: 'sb-1',
        clipId: 'clip-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          description: 'panel',
          videoPromptEditedByUser: true,
          firstLastFramePromptEditedByUser: true,
        }],
      }],
      panelVideoStates: {
        getTaskState: () => null,
      },
      panelLipStates: {
        getTaskState: () => null,
      },
    })

    expect(result.allPanels[0]?.videoPromptEditedByUser).toBe(true)
    expect(result.allPanels[0]?.firstLastFramePromptEditedByUser).toBe(true)
  })

  it('projects canonical prompt fingerprint source from episode panel media and context', () => {
    const result = useVideoPanelsProjection({
      clips: [{ id: 'clip-1', start: 0, end: 5, summary: 'clip' }],
      storyboards: [{
        id: 'sb-1',
        clipId: 'clip-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          imageUrl: '/m/public-1',
          media: { publicId: 'public-1', storageKey: 'one.png', sha256: 'sha-1' },
          description: 'description',
          imagePrompt: 'image prompt',
          videoPrompt: 'video prompt',
          shotType: 'wide',
          cameraMove: 'pan',
          location: 'room',
          characters: '["A"]',
          props: 'book',
          srtSegment: 'dialogue',
          sceneType: 'interior',
          videoDurationBinding: { mode: 'manual', targetDurationSeconds: 8 },
        }],
      }],
      panelVideoStates: { getTaskState: () => null },
      panelLipStates: { getTaskState: () => null },
    })

    expect(result.allPanels[0]?.firstLastFramePromptFingerprintSource).toMatchObject({
      imageMedia: { publicId: 'public-1', storageKey: 'one.png', sha256: 'sha-1' },
      description: 'description',
      imagePrompt: 'image prompt',
      videoPrompt: 'video prompt',
      characters: '["A"]',
      props: 'book',
      sceneType: 'interior',
      videoDurationBinding: { mode: 'manual', targetDurationSeconds: 8 },
    })
  })
})
