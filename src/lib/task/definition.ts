import { TASK_TYPE, type QueueType, type TaskType } from './types'
import type { WorkspaceResourceImpact } from '@/lib/workspace-resource/resource-impact'

export type TaskTargetTerminalProjector =
  | 'none'

export type ImageTaskHandlerKey =
  | 'creative_resource_image'

export type VideoTaskHandlerKey = 'creative_resource_video' | 'creative_resource_video_merge'
export type MusicTaskHandlerKey = 'creative_resource_audio'
export type VoiceTaskHandlerKey = 'creative_resource_voice'
export type TextTaskHandlerKey = 'creative_work'

type TaskHandlerByQueue = {
  image: ImageTaskHandlerKey
  video: VideoTaskHandlerKey
  music: MusicTaskHandlerKey
  voice: VoiceTaskHandlerKey
  text: TextTaskHandlerKey
}

export type TaskBillingPolicy = 'none' | 'text' | 'image' | 'video' | 'music' | 'voice'
export type TaskExecutionProtocol = 'handler_result_checkpoint'
export type TaskTerminalSuccessHandoff = 'handler_result_checkpoint'
export type TaskTerminalOutputMaterializer = 'none' | 'creative_resource' | 'domain_creative_resource'
export type TaskSubmissionTargetOwnership = 'none'
export type TaskContinuationResultProjection = 'full' | 'reference'
export type TaskLifecyclePayloadProjection = 'full' | 'reference'

export type TaskDefinition<Q extends QueueType = QueueType> = {
  queue: Q
  workerHandler: TaskHandlerByQueue[Q]
  billingPolicy: TaskBillingPolicy
  maxAttempts: number
  executionProtocol: TaskExecutionProtocol
  terminalSuccessHandoff: TaskTerminalSuccessHandoff
  terminalOutputMaterializer: TaskTerminalOutputMaterializer
  submissionTargetOwnership: TaskSubmissionTargetOwnership
  terminalResourceImpact: WorkspaceResourceImpact
  terminalFailureProjector: TaskTargetTerminalProjector
  terminalCancelProjector: TaskTargetTerminalProjector
  continuationResultProjection: TaskContinuationResultProjection
  lifecyclePayloadProjection: TaskLifecyclePayloadProjection
}

function definition<Q extends QueueType>(
  queue: Q,
  workerHandler: TaskHandlerByQueue[Q],
  billingPolicy: TaskBillingPolicy,
  maxAttempts: number,
  terminalResourceImpact: WorkspaceResourceImpact,
  terminalFailureProjector: TaskTargetTerminalProjector,
  terminalCancelProjector: TaskTargetTerminalProjector,
  submissionTargetOwnership: TaskSubmissionTargetOwnership,
  terminalOutputMaterializer: TaskTerminalOutputMaterializer = 'none',
  continuationResultProjection: TaskContinuationResultProjection = 'full',
  lifecyclePayloadProjection: TaskLifecyclePayloadProjection = 'full',
): TaskDefinition<Q> {
  return {
    queue,
    workerHandler,
    billingPolicy,
    maxAttempts,
    executionProtocol: 'handler_result_checkpoint',
    terminalSuccessHandoff: 'handler_result_checkpoint',
    terminalOutputMaterializer,
    submissionTargetOwnership,
    continuationResultProjection,
    lifecyclePayloadProjection,
    terminalResourceImpact,
    terminalFailureProjector,
    terminalCancelProjector,
  }
}

export const TASK_DEFINITIONS = {
  [TASK_TYPE.CREATIVE_WORK]: definition(
    'text',
    'creative_work',
    'none',
    3,
    'creative_resources',
    'none',
    'none',
    'none',
    'domain_creative_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.CREATIVE_RESOURCE_IMAGE]: definition('image', 'creative_resource_image', 'image', 3, 'creative_resources', 'none', 'none', 'none', 'creative_resource'),
  [TASK_TYPE.CREATIVE_RESOURCE_AUDIO]: definition('music', 'creative_resource_audio', 'music', 3, 'creative_resources', 'none', 'none', 'none', 'creative_resource'),
  [TASK_TYPE.CREATIVE_RESOURCE_VOICE]: definition('voice', 'creative_resource_voice', 'voice', 3, 'creative_resources', 'none', 'none', 'none', 'creative_resource'),
  [TASK_TYPE.CREATIVE_RESOURCE_VIDEO]: definition('video', 'creative_resource_video', 'video', 3, 'creative_resources', 'none', 'none', 'none', 'creative_resource'),
  [TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE]: definition('video', 'creative_resource_video_merge', 'none', 1, 'creative_resources', 'none', 'none', 'none', 'creative_resource'),
} satisfies Record<TaskType, TaskDefinition>

export function getTaskDefinition(type: TaskType): TaskDefinition {
  const taskDefinition = TASK_DEFINITIONS[type] as TaskDefinition | undefined
  if (!taskDefinition) throw new Error(`TASK_DEFINITION_MISSING:${String(type)}`)
  return taskDefinition
}

export function getTaskDefinitionForQueue<Q extends QueueType>(type: TaskType, queue: Q): TaskDefinition<Q> {
  const taskDefinition = getTaskDefinition(type)
  if (taskDefinition.queue !== queue) {
    throw new Error(`TASK_QUEUE_MISMATCH:${type}:${taskDefinition.queue}:${queue}`)
  }
  return taskDefinition as TaskDefinition<Q>
}
