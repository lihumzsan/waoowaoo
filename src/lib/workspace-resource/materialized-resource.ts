import { readEpisodeEditBible, readEpisodeEditChapters } from '@/lib/edit-bible'
import { readProjectEpisodeDetail } from '@/lib/projects/read-episode-detail'
import { getTaskDefinition } from '@/lib/task/definition'
import type { TaskJobData, WorkspaceMaterializedResourceEnvelope } from '@/lib/task/types'
import {
  parseWorkspaceMaterializedResourceVersion,
  workspaceMaterializedResourceKey,
} from './materialized-resource-version'
import { createEditBibleQueryDto } from './query-dto-version'
import { readConsistentWorkspaceResourceSnapshot } from './resource-revision'

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

  const materializer = getTaskDefinition(task.type).materializer
  if (materializer === 'edit_bible') {
    const snapshot = await readConsistentWorkspaceResourceSnapshot({
      projectId: task.projectId,
      episodeId,
      read: async () => {
        const [editBible, chapters] = await Promise.all([
          readEpisodeEditBible({ projectId: task.projectId, episodeId }),
          readEpisodeEditChapters({ projectId: task.projectId, episodeId }),
        ])
        return { editBible, chapters }
      },
    })
    const { editBible, chapters } = snapshot.data
    if (!editBible) throw new Error(`CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING:editBible:${task.taskId}`)
    const data = createEditBibleQueryDto(editBible, chapters, snapshot.resourceRevision)
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

  if (materializer !== 'episode_data') {
    const exhaustive: never = materializer
    throw new Error(`TASK_MATERIALIZER_UNSUPPORTED:${task.type}:${String(exhaustive)}`)
  }

  const episode = await readProjectEpisodeDetail({
    projectId: task.projectId,
    episodeId,
  })
  const resourceVersion = parseWorkspaceMaterializedResourceVersion(
    'episodeData',
    episode.resourceVersion,
  )
  if (!resourceVersion || resourceVersion.scheme !== 'resource_revision') {
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
