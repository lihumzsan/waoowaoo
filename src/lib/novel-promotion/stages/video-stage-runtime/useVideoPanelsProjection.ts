'use client'

import { useMemo } from 'react'
import type {
  Clip,
  Storyboard,
  VideoPanel,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import { parseVideoDurationBinding } from '@/lib/video-duration/audio-binding'

interface TaskStateLike {
  phase?: string | null
  lastError?: { code?: string; message?: string } | null
}

interface TaskPresentationLike {
  getTaskState: (key: string) => TaskStateLike | null
}

interface UseVideoPanelsProjectionParams {
  storyboards: Storyboard[]
  clips: Clip[]
  panelVideoStates: TaskPresentationLike
  panelLipStates: TaskPresentationLike
}

function normalizeRuntimeTaskPhase(
  value: string | null | undefined,
): VideoPanel['videoTaskPhase'] {
  if (
    value === 'queued'
    || value === 'processing'
    || value === 'completed'
    || value === 'failed'
    || value === 'idle'
  ) {
    return value
  }
  return 'idle'
}

export function useVideoPanelsProjection({
  storyboards,
  clips,
  panelVideoStates,
  panelLipStates,
}: UseVideoPanelsProjectionParams) {
  const sortedStoryboards = useMemo(() => {
    return [...storyboards].sort((left, right) => {
      const leftIndex = clips.findIndex((clip) => clip.id === left.clipId)
      const rightIndex = clips.findIndex((clip) => clip.id === right.clipId)
      return leftIndex - rightIndex
    })
  }, [clips, storyboards])

  const allPanels = useMemo<VideoPanel[]>(() => {
    const panels: VideoPanel[] = []
    sortedStoryboards.forEach((storyboard) => {
      const storyboardPanels = storyboard.panels || []
      storyboardPanels.forEach((panel, index) => {
        const actualPanelIndex = panel.panelIndex ?? index
        let charactersArray: string[] = []
        if (panel.characters) {
          try {
            const parsed = typeof panel.characters === 'string' ? JSON.parse(panel.characters) : panel.characters
            charactersArray = Array.isArray(parsed) ? parsed : []
          } catch {
            charactersArray = []
          }
        }

        const panelId = panel.id
        const panelVideoState = panelId ? panelVideoStates.getTaskState(`panel-video:${panelId}`) : null
        const panelLipState = panelId ? panelLipStates.getTaskState(`panel-lip:${panelId}`) : null
        const videoTaskPhase = normalizeRuntimeTaskPhase(panelVideoState?.phase)
        const lipSyncTaskPhase = normalizeRuntimeTaskPhase(panelLipState?.phase)

        panels.push({
          panelId,
          storyboardId: storyboard.id,
          panelIndex: actualPanelIndex,
          textPanel: {
            panel_number: panel.panelNumber || actualPanelIndex + 1,
            shot_type: panel.shotType || '',
            camera_move: panel.cameraMove || '',
            description: panel.description || '',
            characters: charactersArray,
            location: panel.location || '',
            text_segment: panel.srtSegment || '',
            duration: panel.duration || undefined,
            imagePrompt: panel.imagePrompt || undefined,
            video_prompt: panel.videoPrompt || undefined,
            videoModel: panel.videoModel || undefined,
          },
          imageUrl: panel.imageUrl || undefined,
          firstLastFramePrompt: panel.firstLastFramePrompt || undefined,
          videoDurationBinding: parseVideoDurationBinding(panel.videoDurationBinding),
          videoUrl: panel.videoUrl || undefined,
          videoGenerationMode: panel.videoGenerationMode || undefined,
          videoTaskPhase,
          videoTaskRunning: videoTaskPhase === 'queued' || videoTaskPhase === 'processing',
          videoErrorCode:
            videoTaskPhase === 'failed'
              ? panelVideoState?.lastError?.code || panel.videoErrorCode || undefined
              : panel.videoErrorCode || undefined,
          videoErrorMessage:
            videoTaskPhase === 'failed'
              ? panelVideoState?.lastError?.message || panel.videoErrorMessage || undefined
              : panel.videoErrorMessage || undefined,
          hasPreviousVideoVersion: panel.hasPreviousVideoVersion ?? false,
          videoModel: panel.videoModel || undefined,
          linkedToNextPanel: panel.linkedToNextPanel || false,
          lipSyncVideoUrl: panel.lipSyncVideoUrl || undefined,
          lipSyncTaskPhase,
          lipSyncTaskRunning: lipSyncTaskPhase === 'queued' || lipSyncTaskPhase === 'processing',
          lipSyncErrorCode:
            lipSyncTaskPhase === 'failed'
              ? panelLipState?.lastError?.code || panel.lipSyncErrorCode || undefined
              : panel.lipSyncErrorCode || undefined,
          lipSyncErrorMessage:
            lipSyncTaskPhase === 'failed'
              ? panelLipState?.lastError?.message || panel.lipSyncErrorMessage || undefined
              : panel.lipSyncErrorMessage || undefined,
        })
      })
    })
    return panels
  }, [panelLipStates, panelVideoStates, sortedStoryboards])

  return {
    sortedStoryboards,
    allPanels,
  }
}
