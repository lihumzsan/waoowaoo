import { readEpisodeEditBible, readEpisodeEditChapters } from '@/lib/edit-bible'
import { readProjectEpisodeDetail } from '@/lib/projects/read-episode-detail'
import {
  TASK_TYPE,
  type TaskJobData,
  type WorkspaceMaterializedResourceEnvelope,
  type WorkspaceResourceName,
} from '@/lib/task/types'

function resourceKey(kind: WorkspaceResourceName, projectId: string, episodeId: string): string {
  return `${kind}:${projectId}:${episodeId}`
}

function envelope(input: {
  readonly kind: WorkspaceResourceName
  readonly taskId: string
  readonly projectId: string
  readonly episodeId: string
  readonly resourceVersion: string
  readonly data: unknown
}): WorkspaceMaterializedResourceEnvelope {
  return {
    ...input,
    resourceKey: resourceKey(input.kind, input.projectId, input.episodeId),
  }
}

function isEditBibleQueryTask(taskType: string): boolean {
  return taskType === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE
    || taskType === TASK_TYPE.EDIT_BIBLE_GENERATE
    || taskType === TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE
    || taskType === TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE
}

/**
 * Reads the same DTO consumed by the canvas Query Cache after the worker has
 * persisted its output. Canvas tasks must materialize one primary query
 * resource; invalidation of secondary resources remains separate.
 */
export async function materializeWorkspaceResourcesForTask(
  task: TaskJobData,
): Promise<readonly WorkspaceMaterializedResourceEnvelope[]> {
  const payloadEpisodeId = typeof task.payload?.episodeId === 'string'
    ? task.payload.episodeId.trim()
    : ''
  const episodeId = task.episodeId?.trim() || payloadEpisodeId || null
  if (!episodeId) return []

  if (isEditBibleQueryTask(task.type)) {
    const [editBible, chapters] = await Promise.all([
      readEpisodeEditBible({ projectId: task.projectId, episodeId }),
      readEpisodeEditChapters({ projectId: task.projectId, episodeId }),
    ])
    if (!editBible) throw new Error(`CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING:editBible:${task.taskId}`)
    return [envelope({
      kind: 'editBible',
      taskId: task.taskId,
      projectId: task.projectId,
      episodeId,
      resourceVersion: String(editBible.version),
      data: {
        editBible: {
          ...editBible,
          chapters,
        },
        chapters,
      },
    })]
  }

  const episode = await readProjectEpisodeDetail({
    projectId: task.projectId,
    episodeId,
  })
  const updatedAt = 'updatedAt' in episode && episode.updatedAt instanceof Date
    ? episode.updatedAt.toISOString()
    : task.taskId
  return [envelope({
    kind: 'episodeData',
    taskId: task.taskId,
    projectId: task.projectId,
    episodeId,
    resourceVersion: updatedAt,
    data: episode,
  })]
}
