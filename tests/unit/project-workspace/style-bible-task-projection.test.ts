import { describe, expect, it } from 'vitest'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/projection/workspace-node-canvas-projection'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import type { ProjectEditBible } from '@/types/project'

/**
 * Logic Specification
 * Authority: CN-01/CN-02A/CN-02B/CN-07 and the Style Bible Canvas projection.
 * Rejects: waiting for persisted style-preview rows before projecting the running text Task.
 * Production entry: buildWorkspaceNodeCanvasProjection.
 * Oracle: the text Task projects the one canonical Style Bible node and runtime target.
 * Command: npx vitest run tests/unit/project-workspace/style-bible-task-projection.test.ts
 */

const editBible: ProjectEditBible = {
  id: 'edit-bible-1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  status: 'confirmed',
  styleBible: null,
  stylePreviews: [],
}

describe('Style Bible text Task Canvas projection', () => {
  it('projects the stable placeholder before style directions are persisted', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: {
        active: true,
        stage: 'style_preview_generating',
        blocking: { kind: 'processing', reason: 'visual style generation is still running' },
        nextAction: null,
        allowedOperationIds: [],
        operationGroup: null,
      },
      editBible,
      activeTaskTargets: [{
        taskId: 'style-options-task-1',
        targetType: 'ProjectEditBible',
        targetId: editBible.id,
        types: ['edit_style_preview_options_generate'],
      }],
      savedLayouts: [],
      translate: (key) => key,
    })

    const styleBibleNodes = projection.nodes.filter((node) => node.data.kind === 'editStyleBible')
    expect(styleBibleNodes).toHaveLength(1)
    expect(styleBibleNodes[0]).toMatchObject({
      id: workspaceNodeId.editStyleBible(editBible.id),
      data: {
        title: 'nodes.editStyleBible.pendingTitle',
        body: 'nodes.editStyleBible.pendingBody',
        runtimeTargets: [{
          targetType: 'ProjectEditBible',
          targetId: editBible.id,
          types: ['edit_style_preview_options_generate'],
        }],
      },
    })
  })
})
