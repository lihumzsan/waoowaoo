import { describe, expect, it } from 'vitest'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/projection/workspace-node-canvas-projection'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import type { ProjectEditScript } from '@/types/project'

/**
 * Logic Specification
 * Authority: CN-01/CN-06/CN-07 and the editScript multi-chapter reference projection.
 * Rejects: gating all shot-execution nodes on one selected editScript.
 * Production entry: buildWorkspaceNodeCanvasProjection.
 * Oracle: one stable node and one canonical Task target per ready chapter script.
 * Command: npx vitest run tests/unit/project-workspace/multi-chapter-shot-execution-projection.test.ts
 */

function editScript(id: string, chapterId: string): ProjectEditScript {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId,
    durationSec: 30,
    shotCount: 0,
    status: 'ready',
    assetReviewStatus: 'approved',
    shots: [],
    generationSegments: [],
    requirements: [],
  }
}

describe('multi-chapter shot execution Canvas projection', () => {
  it('projects every chapter target through the existing node lifecycle contract', () => {
    const scripts = [
      editScript('edit-script-1', 'chapter-1'),
      editScript('edit-script-2', 'chapter-2'),
    ]
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: {
        active: true,
        stage: 'ready_to_generate_shot_execution_plan',
        blocking: { kind: 'processing', reason: 'shot execution plans are generating' },
        nextAction: null,
        allowedOperationIds: [],
        operationGroup: null,
      },
      editScripts: scripts,
      editShotExecutionPlans: [],
      savedLayouts: [],
      translate: (key) => key,
    })

    const nodes = projection.nodes.filter((node) => node.data.kind === 'editShotExecutionPlan')
    expect(nodes.map((node) => node.id)).toEqual([
      workspaceNodeId.editShotExecutionPlan('edit-script-1'),
      workspaceNodeId.editShotExecutionPlan('edit-script-2'),
    ])
    expect(nodes.map((node) => node.data.runtimeTargets)).toEqual([
      [{ targetType: 'ProjectEditScript', targetId: 'edit-script-1', types: ['edit_shot_execution_plan_generate'] }],
      [{ targetType: 'ProjectEditScript', targetId: 'edit-script-2', types: ['edit_shot_execution_plan_generate'] }],
    ])
    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: workspaceNodeId.editScript('episode-1', 'chapter-1'),
        target: workspaceNodeId.editShotExecutionPlan('edit-script-1'),
      }),
      expect.objectContaining({
        source: workspaceNodeId.editScript('episode-1', 'chapter-2'),
        target: workspaceNodeId.editShotExecutionPlan('edit-script-2'),
      }),
    ]))
  })
})
