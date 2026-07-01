import { describe, expect, it } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectEditScript, ProjectPanel, ProjectStoryboard } from '@/types/project'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'

function t(key: string, values?: Record<string, string | number>): string {
  if (!values) return key
  return `${key}:${JSON.stringify(values)}`
}

function workflow(stage: EditFirstWorkflowState['stage']): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: {
      kind: 'none',
      reason: null,
    },
    nextAction: null,
    allowedOperationIds: [],
  }
}

function editScript(): ProjectEditScript {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    userPrompt: 'story prompt',
    styleBible: null,
    screenplayText: 'screenplay text',
    durationSec: 30,
    shotCount: 2,
    status: 'ready',
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: [{ shotNumbers: [1, 2], continuity: 'two-shot segment' }],
    requirements: [],
  }
}

function panel(overrides: {
  readonly id: string
  readonly panelIndex: number
  readonly panelNumber: number
  readonly sourceShotNumber: number
  readonly imageUrl?: string | null
}): ProjectPanel {
  return {
    id: overrides.id,
    storyboardId: 'storyboard-1',
    panelIndex: overrides.panelIndex,
    panelNumber: overrides.panelNumber,
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
    imageUrl: overrides.imageUrl ?? null,
    videoPrompt: 'panel video prompt',
    videoUrl: null,
    actingNotes: null,
    sourceShotNumber: overrides.sourceShotNumber,
    sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
  }
}

function storyboard(panels: readonly ProjectPanel[]): ProjectStoryboard {
  return {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    editScriptId: 'edit-script-1',
    storyboardTextJson: null,
    panelCount: panels.length,
    storyboardImageUrl: null,
    lastError: null,
    storyboardTaskRunning: false,
    panels: [...panels],
  }
}

function groupedStoryboard(input: { readonly withImages: boolean }): ProjectStoryboard {
  return storyboard([
    panel({
      id: 'panel-1',
      panelIndex: 0,
      panelNumber: 1,
      sourceShotNumber: 1,
      imageUrl: input.withImages ? '/images/panel-1.png' : null,
    }),
    panel({
      id: 'panel-2',
      panelIndex: 1,
      panelNumber: 2,
      sourceShotNumber: 2,
      imageUrl: input.withImages ? '/images/panel-2.png' : null,
    }),
  ])
}

describe('project canvas video plan actions', () => {
  it('does not expose storyboard grid generation on video plan segment nodes', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [groupedStoryboard({ withImages: true })],
      editFirstWorkflow: workflow('ready_to_generate_videos'),
      editScript: editScript(),
      savedLayouts: [],
      translate: t,
    })
    const videoPlan = projection.nodes.find((node) => node.data.kind === 'videoPlan')

    expect(videoPlan?.data.action).toEqual({
      type: 'generate_video_group',
      gridMode: '2x2',
      shotNumbers: [1, 2],
    })
    expect(videoPlan?.data.secondaryAction).toEqual({
      type: 'open_video_block_arrangement',
      editScriptId: 'edit-script-1',
      segmentIndex: 0,
    })
    expect(videoPlan?.data.tertiaryAction).toBeUndefined()
    expect(videoPlan?.data.tertiaryActionLabel).toBeUndefined()
  })

  it('routes grouped shot image buttons through the storyboard grid image operation', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [groupedStoryboard({ withImages: false })],
      editFirstWorkflow: workflow('ready_to_generate_storyboard_images'),
      editScript: editScript(),
      savedLayouts: [],
      translate: t,
    })
    const shotActions = projection.nodes
      .filter((node) => node.data.kind === 'shot')
      .map((node) => node.data.action)

    expect(shotActions).toEqual([
      {
        type: 'generate_storyboard_grid_images',
        episodeId: 'episode-1',
        editScriptId: 'edit-script-1',
        sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
        panelIds: ['panel-1', 'panel-2'],
        generationMode: 'grid',
      },
      {
        type: 'generate_storyboard_grid_images',
        episodeId: 'episode-1',
        editScriptId: 'edit-script-1',
        sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
        panelIds: ['panel-1', 'panel-2'],
        generationMode: 'grid',
      },
    ])
  })
})
