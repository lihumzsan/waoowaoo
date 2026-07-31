import { TASK_TYPE, type TaskType } from './types'
import type { WorkspaceResourceImpact } from '@/lib/workspace-resource/resource-impact'
import type { WorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'

export type TaskSchedulerClass = keyof WorkflowConcurrencyConfig

export type TaskTargetTerminalProjector = 'none'

export type TaskExecutionHandlerKey =
  | 'creative_work'
  | 'creative_resource_image'
  | 'creative_resource_web_reference'
  | 'creative_resource_audio'
  | 'creative_resource_voice'
  | 'creative_resource_video'
  | 'creative_resource_video_merge'

export type TaskBillingPolicy = 'none' | 'text' | 'image' | 'video' | 'music' | 'voice'
export type TaskExecutionProtocol = 'handler_result_checkpoint'
export type TaskTerminalSuccessHandoff = 'handler_result_checkpoint'
export type TaskTerminalOutputMaterializer =
  | 'none'
  | 'creative_resource'
  | 'domain_creative_resource'
export type TaskSubmissionTargetOwnership = 'none'
export type TaskTerminalModelKeyRequirement = 'required' | 'none'
export type TaskContinuationResultProjection = 'full' | 'reference'
export type TaskLifecyclePayloadProjection = 'full' | 'reference'

export const CREATIVE_WORK_EXECUTION_DEADLINE_MS = 20 * 60_000

export type TaskDefinition = {
  executionHandler: TaskExecutionHandlerKey
  billingPolicy: TaskBillingPolicy
  maxAttempts: number
  schedulerClass: TaskSchedulerClass | null
  executionProtocol: TaskExecutionProtocol
  terminalSuccessHandoff: TaskTerminalSuccessHandoff
  terminalOutputMaterializer: TaskTerminalOutputMaterializer
  submissionTargetOwnership: TaskSubmissionTargetOwnership
  terminalResourceImpact: WorkspaceResourceImpact
  terminalFailureProjector: TaskTargetTerminalProjector
  terminalCancelProjector: TaskTargetTerminalProjector
  continuationResultProjection: TaskContinuationResultProjection
  lifecyclePayloadProjection: TaskLifecyclePayloadProjection
  executionDeadlineMs: number | null
  /**
   * Whether the terminal handler result must carry the model key that produced
   * the artifact. Declared here so a task type that runs no model is a registry
   * fact rather than a special case inside the materializer.
   */
  terminalModelKeyRequirement: TaskTerminalModelKeyRequirement
}

function definition(
  executionHandler: TaskExecutionHandlerKey,
  billingPolicy: TaskBillingPolicy,
  maxAttempts: number,
  schedulerClass: TaskSchedulerClass | null,
  terminalResourceImpact: WorkspaceResourceImpact,
  terminalFailureProjector: TaskTargetTerminalProjector,
  terminalCancelProjector: TaskTargetTerminalProjector,
  submissionTargetOwnership: TaskSubmissionTargetOwnership,
  terminalOutputMaterializer: TaskTerminalOutputMaterializer = 'none',
  continuationResultProjection: TaskContinuationResultProjection = 'full',
  lifecyclePayloadProjection: TaskLifecyclePayloadProjection = 'full',
  terminalModelKeyRequirement: TaskTerminalModelKeyRequirement = 'required',
  executionDeadlineMs: number | null = null,
): TaskDefinition {
  return {
    executionHandler,
    billingPolicy,
    maxAttempts,
    schedulerClass,
    executionProtocol: 'handler_result_checkpoint',
    terminalSuccessHandoff: 'handler_result_checkpoint',
    terminalOutputMaterializer,
    submissionTargetOwnership,
    continuationResultProjection,
    lifecyclePayloadProjection,
    executionDeadlineMs,
    terminalResourceImpact,
    terminalFailureProjector,
    terminalCancelProjector,
    terminalModelKeyRequirement,
  }
}

export const TASK_DEFINITIONS = {
  [TASK_TYPE.CREATIVE_WORK]: definition(
    'creative_work',
    'none',
    3,
    'analysis',
    'creative_resources',
    'none',
    'none',
    'none',
    'domain_creative_resource',
    'reference',
    'reference',
    'required',
    CREATIVE_WORK_EXECUTION_DEADLINE_MS,
  ),
  [TASK_TYPE.CREATIVE_RESOURCE_IMAGE]: definition(
    'creative_resource_image',
    'image',
    3,
    'image',
    'creative_resources',
    'none',
    'none',
    'none',
    'creative_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE]: definition(
    'creative_resource_web_reference',
    'none',
    3,
    'image',
    'creative_resources',
    'none',
    'none',
    'none',
    'creative_resource',
    'reference',
    'reference',
    'none',
  ),
  [TASK_TYPE.CREATIVE_RESOURCE_AUDIO]: definition(
    'creative_resource_audio',
    'music',
    3,
    'image',
    'creative_resources',
    'none',
    'none',
    'none',
    'creative_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.CREATIVE_RESOURCE_VOICE]: definition(
    'creative_resource_voice',
    'voice',
    3,
    'image',
    'creative_resources',
    'none',
    'none',
    'none',
    'creative_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.CREATIVE_RESOURCE_VIDEO]: definition(
    'creative_resource_video',
    'video',
    3,
    'video',
    'creative_resources',
    'none',
    'none',
    'none',
    'creative_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE]: definition(
    'creative_resource_video_merge',
    'none',
    1,
    'video',
    'creative_resources',
    'none',
    'none',
    'none',
    'creative_resource',
    'reference',
    'reference',
    'none',
  ),
} satisfies Record<TaskType, TaskDefinition>

export function getTaskDefinition(type: TaskType): TaskDefinition {
  const taskDefinition = TASK_DEFINITIONS[type] as TaskDefinition | undefined
  if (!taskDefinition) throw new Error(`TASK_DEFINITION_MISSING:${String(type)}`)
  return taskDefinition
}
