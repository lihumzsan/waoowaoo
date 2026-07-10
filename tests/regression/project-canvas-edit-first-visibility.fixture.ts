import { describe, expect, it } from 'vitest'

import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

import type {
  ProjectEditAssetRequirement,
  ProjectEditBible,
  ProjectEditScript,
  ProjectEditShotExecutionPlan,
  ProjectFinalVideo,
  ProjectPanel,
  ProjectStoryboard,
  ProjectVideoGroup,
} from '@/types/project'

import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'

import {
  WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
} from '@/features/project-workspace/canvas/node-presentation-profiles'

function t(key: string, values?: Record<string, string | number>): string {
  if (!values) return key
  return `${key}:${JSON.stringify(values)}`
}

function workflow(
  stage: EditFirstWorkflowState['stage'],
  allowedOperationIds: EditFirstWorkflowState['allowedOperationIds'] = [],
): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: {
      kind: stage === 'failed' ? 'failed' : 'none',
      reason: stage === 'failed' ? 'workflow failed' : null,
    },
    nextAction: null,
    allowedOperationIds,
  }
}

function requirement(
  overrides: Partial<ProjectEditAssetRequirement> = {},
): ProjectEditAssetRequirement {
  return {
    id: 'requirement-location-1',
    kind: 'location',
    name: '客厅',
    description: '昏暗客厅',
    shotIds: ['shot-1'],
    status: 'completed',
    targetId: 'location-1',
    taskTargetType: 'LocationImage',
    taskTargetId: 'location-1',
    errorMessage: null,
    previewImageUrl: '/images/living-room.png',
    ...overrides,
  }
}

function editBible(overrides: Partial<ProjectEditBible> = {}): ProjectEditBible {
  return {
    id: 'bible-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'story prompt',
    bibleText: 'bible text',
    status: 'ready_for_review',
    ...overrides,
  }
}

function editScript(input: {
  readonly status: string
  readonly requirements?: readonly ProjectEditAssetRequirement[]
  readonly generationSegments?: ProjectEditScript['generationSegments']
}): ProjectEditScript {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    bibleId: 'bible-1',
    userPrompt: 'story prompt',
    styleBible: null,
    bibleText: 'bible text',
    durationSec: 30,
    shotCount: input.generationSegments?.flatMap((segment) => segment.shotIds).length ?? 0,
    status: input.status,
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: [...(input.generationSegments ?? [])],
    requirements: [...(input.requirements ?? [])],
  }
}

function shotExecutionPlan(): ProjectEditShotExecutionPlan {
  return {
    id: 'shot-execution-plan-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    editScriptId: 'edit-script-1',
    status: 'ready',
    shots: [{
      shotId: 'shot-1',
      shotNumber: 1,
      camera: {
        shotScale: '中景',
        lens: '35mm',
        focus: '林晓',
        height: 'eye level',
        angle: 'front',
        movement: 'static',
        composition: 'centered',
        lighting: 'low key',
      },
      blocking: {
        axis: {
          type: 'dialogue',
          subjects: ['林晓'],
          screenDirection: 'left to right',
        },
        characters: [{
          name: '林晓',
          visibility: 'visible',
          position: '沙发前',
          screenPosition: 'center',
          facing: 'camera',
          eyeline: 'phone',
        }],
        objects: [],
        spatialNote: '林晓坐在客厅沙发前。',
      },
      videoPrompt: 'shot video prompt',
    }],
    generationSegmentExecutions: [],
  }
}

function panel(): ProjectPanel {
  return {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    panelNumber: 1,
    shotType: '中景',
    cameraMove: 'static',
    description: '林晓坐在客厅里。',
    location: '客厅',
    characters: '林晓',
    props: null,
    srtSegment: null,
    srtStart: null,
    srtEnd: null,
    duration: 4,
    imagePrompt: 'panel image prompt',
    imageUrl: null,
    videoPrompt: 'panel video prompt',
    videoUrl: null,
    actingNotes: null,
    sourceShotId: 'shot-1',
  }
}

function storyboard(): ProjectStoryboard {
  return {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    editScriptId: 'edit-script-1',
    storyboardTextJson: null,
    panelCount: 1,
    storyboardImageUrl: null,
    lastError: null,
    storyboardTaskRunning: false,
    panels: [panel()],
  }
}

function videoGroup(overrides: Partial<ProjectVideoGroup> = {}): ProjectVideoGroup {
  return {
    id: 'video-group-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    gridMode: '2x2',
    shotIds: ['shot-1'],
    durationSec: 3,
    prompt: 'video prompt',
    status: 'completed',
    taskId: null,
    errorCode: null,
    errorMessage: null,
    referenceImageUrl: null,
    referenceImageMedia: null,
    videoUrl: '/videos/group-1.mp4',
    videoMedia: null,
    ...overrides,
  }
}

function finalVideo(overrides: Partial<ProjectFinalVideo> = {}): ProjectFinalVideo {
  return {
    id: 'final-1',
    episodeId: 'episode-1',
    renderStatus: null,
    renderTaskId: null,
    outputUrl: null,
    updatedAt: null,
    musicScore: {
      status: 'completed',
      taskId: 'task-bgm-1',
      timelineSignature: 'timeline-signature',
      durationSeconds: 30,
      musicModel: 'music-model',
      mix: {
        mediaId: 'media-bgm-1',
        url: '/music/bgm.mp3',
        storageKey: 'music/bgm.mp3',
        mimeType: 'audio/mpeg',
        durationMs: 30_000,
      },
    },
    soundscape: {
      status: 'completed',
      taskId: 'task-soundscape-1',
      timelineSignature: 'timeline-signature',
      soundEffectModel: 'sound-effect-model',
      decision: 'soundscape',
      sourceCount: 1,
      sectionCount: 2,
      mix: {
        mediaId: 'media-soundscape-1',
        url: '/soundscape/mix.m4a',
        storageKey: 'soundscape/mix.m4a',
        mimeType: 'audio/mp4',
        durationMs: 30_000,
      },
    },
    ...overrides,
  }
}

export { describe, expect, it } from 'vitest'
export type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
export type { ProjectEditAssetRequirement, ProjectEditBible, ProjectEditScript, ProjectEditShotExecutionPlan, ProjectFinalVideo, ProjectPanel, ProjectStoryboard, ProjectVideoGroup } from '@/types/project'
export { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
export { WORKSPACE_CANVAS_DEFAULT_NODE_SIZE, WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE, WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE } from '@/features/project-workspace/canvas/node-presentation-profiles'
export { editBible, editScript, finalVideo, panel, requirement, shotExecutionPlan, storyboard, t, videoGroup, workflow }
