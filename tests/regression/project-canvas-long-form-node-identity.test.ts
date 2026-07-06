import { describe, expect, it } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectEditBible, ProjectEditScript } from '@/types/project'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'

function t(key: string): string {
  return key
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

function editBible(): ProjectEditBible {
  return {
    id: 'bible-row-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status: 'ready',
    textPreview: '全局蓝图',
    chapters: [],
  }
}

function editScript(chapterId: string, shotId: string): ProjectEditScript {
  return {
    id: `edit-script-${chapterId}`,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId,
    bibleId: 'bible-row-1',
    sourceText: 'chapter source',
    durationSec: 6,
    shotCount: 1,
    status: 'ready',
    assetReviewStatus: 'pending',
    shots: [{
      shotId,
      shotNumber: 1,
      durationSec: 6,
      scene: {
        locationId: 'location-1',
        name: '地下室',
        subScene: '工作台',
      },
      action: `shot action ${chapterId}`,
      characters: [{
        characterId: 'character-1',
        name: '民科',
        visibility: 'visible',
        role: 'focus',
        performance: '操作设备',
      }],
      keyObjects: [],
      sound: 'room tone',
    }],
    generationSegments: [],
    requirements: [],
  }
}

describe('long-form project canvas node identity', () => {
  it('keeps the episode bible node id stable across pending and completed states', () => {
    const pending = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: workflow('bible_generating'),
      editScriptPending: true,
      savedLayouts: [],
      translate: t,
    })
    const completed = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: workflow('bible_ready_for_review'),
      editBible: editBible(),
      savedLayouts: [],
      translate: t,
    })

    expect(pending.nodes.find((node) => node.data.kind === 'editBible')?.id)
      .toBe('edit-bible:episode:episode-1')
    expect(completed.nodes.find((node) => node.data.kind === 'editBible')?.id)
      .toBe('edit-bible:episode:episode-1')
  })

  it('creates one core edit table node per chapter and preserves shotId identities', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_assets'),
      editBible: editBible(),
      editScript: editScript('chapter-1', 'shot-chapter-1'),
      editScripts: [
        editScript('chapter-1', 'shot-chapter-1'),
        editScript('chapter-2', 'shot-chapter-2'),
      ],
      savedLayouts: [],
      translate: t,
    })

    const editScriptNodes = projection.nodes.filter((node) => node.data.kind === 'editScript')
    expect(editScriptNodes.map((node) => node.id)).toEqual([
      'edit-script:episode-1:chapter-1',
      'edit-script:episode-1:chapter-2',
    ])
    expect(editScriptNodes.map((node) => node.data.editScriptDetails?.shots[0]?.shotId)).toEqual([
      'shot-chapter-1',
      'shot-chapter-2',
    ])
    expect(editScriptNodes.map((node) => node.data.runtimeTargets?.[0])).toEqual([
      expect.objectContaining({
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-1',
      }),
      expect.objectContaining({
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-2',
      }),
    ])
  })
})
