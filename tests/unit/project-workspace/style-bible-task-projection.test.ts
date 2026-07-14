import { describe, expect, it } from 'vitest'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/projection/workspace-node-canvas-projection'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import type { ProjectEditBible, ProjectEditStylePreview } from '@/types/project'
import { createEditFirstWorkflowView } from '@/lib/project-workflow/edit-first-view'

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

function stylePreview(
  id: 'preview-a' | 'preview-b' | 'preview-c',
  status: ProjectEditStylePreview['status'],
  imageUrl: string | null,
): ProjectEditStylePreview {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    bibleId: 'edit-bible-1',
    styleKey: id === 'preview-a' ? 'style_a' : id === 'preview-b' ? 'style_b' : 'style_c',
    aspectRatio: '16:9',
    title: id,
    summary: `${id} summary`,
    styleBible: {},
    gridImagePrompt: `${id} grid`,
    imageKey: imageUrl ? `${id}.png` : null,
    imageUrl,
    status,
    taskId: `task-${id}`,
    errorMessage: status === 'failed' ? 'provider blocked' : null,
  }
}

describe('Style Bible text Task Canvas projection', () => {
  it('projects the stable placeholder before style directions are persisted', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'visual_style',
        status: { kind: 'processing', reason: 'visual style generation is still running' },
      }),
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

  it('projects a usable candidate set as succeeded when one sibling failed', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'visual_style',
        status: { kind: 'needs_user_choice', reason: 'visual style choice is required' },
      }),
      editBible: {
        ...editBible,
        stylePreviews: [
          stylePreview('preview-a', 'failed', null),
          stylePreview('preview-b', 'completed', '/b.png'),
          stylePreview('preview-c', 'completed', '/c.png'),
        ],
      },
      activeTaskTargets: [],
      savedLayouts: [],
      translate: (key) => key,
    })

    const styleBibleNode = projection.nodes.find((node) => node.data.kind === 'editStyleBible')
    expect(styleBibleNode).toMatchObject({
      id: workspaceNodeId.editStyleBible(editBible.id),
      data: {
        title: 'nodes.editStyleBible.waitingTitle',
        body: 'nodes.editStyleBible.waitingBody',
        lifecycle: { phase: 'succeeded' },
      },
    })
  })
})
