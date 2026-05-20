import { describe, expect, it } from 'vitest'
import type { ProjectClip, ProjectEditScript, ProjectPanel, ProjectStoryboard } from '@/types/project'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'

function t(key: string): string {
  return key
}

function clip(): ProjectClip {
  return {
    id: 'clip-1',
    summary: 'clip',
    location: null,
    characters: null,
    props: null,
    content: 'clip',
    screenplay: null,
  }
}

function panel(panelNumber: number): ProjectPanel {
  return {
    id: `panel-${panelNumber}`,
    storyboardId: 'storyboard-1',
    panelIndex: panelNumber - 1,
    panelNumber,
    shotType: null,
    cameraMove: null,
    description: `panel ${panelNumber}`,
    location: null,
    characters: null,
    props: null,
    srtSegment: null,
    srtStart: null,
    srtEnd: null,
    duration: null,
    imagePrompt: null,
    imageUrl: null,
    candidateImages: null,
    media: null,
    imageHistory: null,
    videoPrompt: null,
    firstLastFramePrompt: null,
    videoUrl: null,
    videoModel: null,
    videoErrorCode: null,
    videoErrorMessage: null,
    videoGenerationMode: null,
    lastVideoGenerationOptions: null,
    videoMedia: null,
    lipSyncVideoUrl: null,
    lipSyncVideoMedia: null,
    lipSyncErrorCode: null,
    lipSyncErrorMessage: null,
    linkedToNextPanel: null,
    sketchImageUrl: null,
    sketchImageMedia: null,
    previousImageUrl: null,
    previousImageMedia: null,
    photographyRules: null,
    actingNotes: null,
    imageTaskRunning: false,
    videoTaskRunning: false,
    imageErrorMessage: null,
  }
}

function storyboard(): ProjectStoryboard {
  const panels = [panel(1), panel(2), panel(3), panel(4)]
  return {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    clipId: 'clip-1',
    storyboardTextJson: null,
    panelCount: panels.length,
    storyboardImageUrl: null,
    candidateImages: null,
    lastError: null,
    photographyPlan: null,
    panels,
  }
}

function editScript(): ProjectEditScript {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'prompt',
    screenplayText: 'screenplay',
    title: 'title',
    logline: null,
    durationSec: 12,
    shotCount: 4,
    status: 'ready',
    shots: [1, 2, 3, 4].map((shotNumber) => ({
      shotNumber,
      durationSec: 3,
      visualAction: `action ${shotNumber}`,
      charactersAndScene: `scene ${shotNumber}`,
      camera: `camera ${shotNumber}`,
      videoPrompt: `video ${shotNumber}`,
      sound: `sound ${shotNumber}`,
    })),
    videoBlocks: [
      {
        kind: 'group',
        shotNumbers: [1, 2],
        gridMode: '2x2',
        reason: 'first block',
        prompt: 'first prompt',
      },
      {
        kind: 'group',
        shotNumbers: [3, 4],
        gridMode: '2x2',
        reason: 'second block',
        prompt: 'second prompt',
      },
    ],
    requirements: [],
  }
}

describe('video block merge selection', () => {
  it('uses a selection action instead of merging immediately from the node button', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyText: 'story',
      clips: [clip()],
      storyboards: [storyboard()],
      editScript: editScript(),
      savedLayouts: [],
      translate: t,
    })

    const videoPlanNodes = projection.nodes.filter((node) => node.data.kind === 'videoPlan')

    expect(videoPlanNodes).toHaveLength(2)
    expect(videoPlanNodes[0]?.data.secondaryAction).toEqual({
      type: 'select_video_block_for_merge',
      editScriptId: 'edit-script-1',
      blockIndex: 0,
    })
    expect(videoPlanNodes[0]?.data.secondaryActionLabel).toBe('actions.selectVideoBlockToMerge')
  })

  it('marks the selected segment and adjacent merge target before submit', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyText: 'story',
      clips: [clip()],
      storyboards: [storyboard()],
      editScript: editScript(),
      savedLayouts: [],
      videoBlockMergeSelection: { editScriptId: 'edit-script-1', blockIndex: 0 },
      translate: t,
    })

    const videoPlanNodes = projection.nodes.filter((node) => node.data.kind === 'videoPlan')

    expect(videoPlanNodes[0]?.data.visualState).toBe('videoBlockMergeSelected')
    expect(videoPlanNodes[0]?.data.secondaryActionLabel).toBe('actions.cancelVideoBlockMerge')
    expect(videoPlanNodes[1]?.data.visualState).toBe('videoBlockMergeCandidate')
    expect(videoPlanNodes[1]?.data.secondaryActionLabel).toBe('actions.mergeWithSelectedVideoBlock')
  })
})
