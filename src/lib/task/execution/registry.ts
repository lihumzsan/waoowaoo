import {
  getTaskDefinition,
  type TaskExecutionHandlerKey,
} from '@/lib/task/definition'
import { handleCreativeResourceAudioTask } from './handlers/creative-resource-audio'
import { handleCreativeResourceImageTask } from './handlers/creative-resource-image'
import { handleCreativeResourceVideoMergeTask } from './handlers/creative-resource-video-merge'
import { handleCreativeResourceVideoTask } from './handlers/creative-resource-video'
import { handleCreativeResourceVoiceTask } from './handlers/creative-resource-voice'
import { handleCreativeResourceWebReferenceTask } from './handlers/creative-resource-web-reference'
import { handleCreativeWorkTask } from './handlers/creative-work'
import { reportTaskProgress } from './progress'
import type {
  TaskExecutionContext,
  TaskExecutionHandler,
  TaskExecutionResult,
} from './context'

const TASK_EXECUTION_HANDLERS = {
  creative_work: handleCreativeWorkTask,
  creative_resource_image: handleCreativeResourceImageTask,
  creative_resource_web_reference: handleCreativeResourceWebReferenceTask,
  creative_resource_audio: handleCreativeResourceAudioTask,
  creative_resource_voice: handleCreativeResourceVoiceTask,
  creative_resource_video: handleCreativeResourceVideoTask,
  creative_resource_video_merge: handleCreativeResourceVideoMergeTask,
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
