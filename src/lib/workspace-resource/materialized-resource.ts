import { readEpisodeEditBible, readEpisodeEditChapters } from '@/lib/edit-bible'
import { readProjectEpisodeDetail } from '@/lib/projects/read-episode-detail'
import {
  TASK_TYPE,
  type TaskJobData,
  type WorkspaceMaterializedResourceEnvelope,
} from '@/lib/task/types'
import {
  parseWorkspaceMaterializedResourceVersion,
  workspaceMaterializedResourceKey,
} from './materialized-resource-version'
import { createEditBibleQueryDto } from './query-dto-version'

function isEditBibleQueryTask(taskType: string): boolean {
  return taskType === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE
    || taskType === TASK_TYPE.EDIT_BIBLE_GENERATE
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
    const data = createEditBibleQueryDto(editBible, chapters)
    return [{
      kind: 'editBible',
      taskId: task.taskId,
      projectId: task.projectId,
      episodeId,
      resourceKey: workspaceMaterializedResourceKey({
        kind: 'editBible',
        projectId: task.projectId,
        episodeId,
      }),
      resourceVersion: data.resourceVersion,
      data,
    }]
  }

  const episode = await readProjectEpisodeDetail({
    projectId: task.projectId,
    episodeId,
  })
  const resourceVersion = parseWorkspaceMaterializedResourceVersion(
    'episodeData',
    episode.resourceVersion,
  )
  if (!resourceVersion || resourceVersion.scheme !== 'aggregate_updated_at') {
    throw new Error(`CANVAS_TERMINAL_RESOURCE_VERSION_MISSING:episodeData:${task.taskId}`)
  }
  return [{
    kind: 'episodeData',
    taskId: task.taskId,
    projectId: task.projectId,
    episodeId,
    resourceKey: workspaceMaterializedResourceKey({
      kind: 'episodeData',
      projectId: task.projectId,
      episodeId,
    }),
    resourceVersion,
    data: episode,
  }]
}
