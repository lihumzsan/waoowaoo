import { describe, expect, it } from 'vitest'
import {
  buildEditStylePreviewSetView,
  resolveEditStylePreviewCardStatus,
} from '@/lib/edit-script/style-preview-set-view'
import type { TaskRuntimeStateLike } from '@/lib/task/runtime-targets'
import type { ProjectEditStylePreview } from '@/types/project'

function preview(
  id: string,
  status: ProjectEditStylePreview['status'],
  imageUrl: string | null = null,
): ProjectEditStylePreview {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    bibleId: 'bible-1',
    styleKey: id === 'preview-a' ? 'style_a' : id === 'preview-b' ? 'style_b' : 'style_c',
    aspectRatio: '16:9',
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    styleBible: {},
    gridImagePrompt: 'grid',
    imageKey: imageUrl ? `${id}.png` : null,
    imageUrl,
    status,
    taskId: status === 'pending' ? null : `task-${id}`,
    errorMessage: status === 'failed' ? 'provider failed' : null,
  }
}

function taskState(phase: TaskRuntimeStateLike['phase']): TaskRuntimeStateLike {
  return {
    phase,
    runningTaskId: phase === 'queued' || phase === 'processing' ? 'task-1' : null,
    runningTaskType: 'edit_style_preview_image',
  }
}

describe('style preview set view', () => {
  it('does not expose planned rows before their generation tasks are committed', () => {
    expect(buildEditStylePreviewSetView({ previews: [preview('preview-a', 'pending')] })).toBeNull()
  })

  it('keeps partial completion visible while another candidate is still running', () => {
    const previews = [
      preview('preview-a', 'completed', '/a.png'),
      preview('preview-b', 'generating'),
      preview('preview-c', 'generating'),
    ]
    const states = new Map<string, TaskRuntimeStateLike>([
      ['preview-a', taskState('completed')],
      ['preview-b', taskState('processing')],
      ['preview-c', taskState('queued')],
    ])

    const view = buildEditStylePreviewSetView({ previews, taskStatesByTargetId: states })

    expect(view?.candidates.map((candidate) => candidate.status)).toEqual([
      'completed', 'generating', 'generating',
    ])
    expect(view?.hasGeneratingPreview).toBe(true)
  })

  it('treats retrying queued work as running and only final failure as failed', () => {
    expect(resolveEditStylePreviewCardStatus({
      preview: preview('preview-a', 'generating'),
      taskState: taskState('queued'),
    })).toBe('generating')
    expect(resolveEditStylePreviewCardStatus({
      preview: preview('preview-a', 'failed'),
      taskState: taskState('failed'),
    })).toBe('failed')
    expect(resolveEditStylePreviewCardStatus({
      preview: preview('preview-a', 'generating'),
      taskState: taskState('canceled'),
    })).toBe('failed')
  })

  it('shows only the confirmed candidate after Style Bible confirmation', () => {
    const view = buildEditStylePreviewSetView({
      previews: [
        preview('preview-a', 'completed', '/a.png'),
        preview('preview-b', 'confirmed', '/b.png'),
        preview('preview-c', 'completed', '/c.png'),
      ],
    })

    expect(view?.candidates.map((candidate) => candidate.id)).toEqual(['preview-b'])
    expect(view?.hasConfirmedPreview).toBe(true)
  })
})
