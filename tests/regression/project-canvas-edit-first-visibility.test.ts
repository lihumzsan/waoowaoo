import { describe, expect, it } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectEditAssetRequirement, ProjectEditScript } from '@/types/project'
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

function requirement(
  overrides: Partial<ProjectEditAssetRequirement> = {},
): ProjectEditAssetRequirement {
  return {
    id: 'requirement-location-1',
    kind: 'location',
    name: '客厅',
    description: '昏暗客厅',
    shotNumbers: [1],
    status: 'completed',
    targetId: 'location-1',
    taskTargetType: 'LocationImage',
    taskTargetId: 'location-1',
    errorMessage: null,
    previewImageUrl: '/images/living-room.png',
    ...overrides,
  }
}

function editScript(input: {
  readonly status: string
  readonly requirements?: readonly ProjectEditAssetRequirement[]
}): ProjectEditScript {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    userPrompt: 'story prompt',
    styleBible: null,
    screenplayText: 'screenplay text',
    durationSec: 30,
    shotCount: 0,
    status: input.status,
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: [],
    requirements: [...(input.requirements ?? [])],
  }
}

describe('project canvas edit-first visibility', () => {
  it('does not render asset or execution nodes while the edit script is still generating', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyText: 'story',
      storyboards: [],
      editFirstWorkflow: workflow('edit_script_generating'),
      editScript: editScript({ status: 'generating' }),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'editScript')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'editAssetGroup')).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'editShotExecutionPlan')).toBe(false)
  })

  it('renders required assets without rendering the shot execution plan before asset review advances', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyText: 'story',
      storyboards: [],
      editFirstWorkflow: workflow('assets_ready_for_review'),
      editScript: editScript({
        status: 'ready',
        requirements: [requirement()],
      }),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'editAssetGroup')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'editShotExecutionPlan')).toBe(false)
  })

  it('does not render a separate location asset node for an edit-first location requirement', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyText: 'story',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_assets'),
      editScript: editScript({
        status: 'ready',
        requirements: [requirement()],
      }),
      savedLayouts: [],
      translate: t,
    })
    const assetGroup = projection.nodes.find((node) => node.data.kind === 'editAssetGroup')

    expect(assetGroup?.data.editAssetGroupDetails?.assets.map((asset) => asset.name)).toEqual(['客厅'])
    expect(projection.nodes.some((node) => node.id.startsWith('location-asset:'))).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'imageAsset')).toBe(false)
  })
})
