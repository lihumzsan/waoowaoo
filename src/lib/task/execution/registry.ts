import {
  getTaskDefinition,
  type TaskExecutionHandlerKey,
} from '@/lib/task/definition'
import { handleWorkspaceResourceAudioTask } from './handlers/workspace-resource-audio'
import { handleWorkspaceResourceImageTask } from './handlers/workspace-resource-image'
import { handleWorkspaceResourceVideoMergeTask } from './handlers/workspace-resource-video-merge'
import { handleWorkspaceResourceVideoTask } from './handlers/workspace-resource-video'
import { handleWorkspaceResourceVoiceTask } from './handlers/workspace-resource-voice'
import { reportTaskProgress } from './progress'
import type {
  TaskExecutionContext,
  TaskExecutionHandler,
  TaskExecutionResult,
} from './context'

const TASK_EXECUTION_HANDLERS = {
  workspace_resource_image: handleWorkspaceResourceImageTask,
  workspace_resource_audio: handleWorkspaceResourceAudioTask,
  workspace_resource_voice: handleWorkspaceResourceVoiceTask,
  workspace_resource_video: handleWorkspaceResourceVideoTask,
  workspace_resource_video_merge: handleWorkspaceResourceVideoMergeTask,
} satisfies Record<TaskExecutionHandlerKey, TaskExecutionHandler>

/**
 * The only Task type -> production handler dispatch.
 *
 * Temporal Activities rebuild canonical Task facts before entering this
 * registry, so handlers never receive transport-owned identity.
 */
export async function executeTaskHandler(
  context: TaskExecutionContext,
): Promise<TaskExecutionResult> {
  await reportTaskProgress(context, 5, { stage: 'received' })
  const definition = getTaskDefinition(context.data.type)
  const handler = TASK_EXECUTION_HANDLERS[definition.executionHandler]
  if (!handler) {
    throw new Error(
      `TASK_EXECUTION_HANDLER_MISSING:${context.data.type}:${definition.executionHandler}`,
    )
  }
  return await handler(context)
}
