import { TASK_TYPE, type TaskType } from './types'
import type { WorkspaceResourceImpact } from '@/lib/workspace-resource/resource-impact'
import type { WorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'

export type TaskSchedulerClass = keyof WorkflowConcurrencyConfig

export type TaskTargetTerminalProjector = 'none'

export type TaskExecutionHandlerKey =
  | 'workspace_resource_image'
  | 'workspace_resource_audio'
  | 'workspace_resource_video'
  | 'workspace_resource_video_frame'
  | 'workspace_resource_video_merge'

export type TaskExecutionProtocol = 'handler_result_checkpoint'
export type TaskTerminalSuccessHandoff = 'handler_result_checkpoint'
export type TaskTerminalOutputMaterializer = 'none' | 'workspace_resource'
export type TaskSubmissionTargetOwnership = 'none'
export type TaskTerminalModelKeyRequirement = 'required' | 'none'
export type TaskContinuationResultProjection = 'full' | 'reference'
export type TaskLifecyclePayloadProjection = 'full' | 'reference'

export type TaskDefinition = {
  executionHandler: TaskExecutionHandlerKey
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
  [TASK_TYPE.WORKSPACE_RESOURCE_IMAGE]: definition(
    'workspace_resource_image',
    3,
    'image',
    'workspace_resources',
    'none',
    'none',
    'none',
    'workspace_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.WORKSPACE_RESOURCE_AUDIO]: definition(
    'workspace_resource_audio',
    3,
    'image',
    'workspace_resources',
    'none',
    'none',
    'none',
    'workspace_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.WORKSPACE_RESOURCE_VIDEO]: definition(
    'workspace_resource_video',
    3,
    'video',
    'workspace_resources',
    'none',
    'none',
    'none',
    'workspace_resource',
    'reference',
    'reference',
  ),
  [TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_FRAME]: definition(
    'workspace_resource_video_frame',
    1,
    'image',
    'workspace_resources',
    'none',
    'none',
    'none',
    'workspace_resource',
    'reference',
    'reference',
    'none',
  ),
  [TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE]: definition(
    'workspace_resource_video_merge',
    1,
    'image',
    'workspace_resources',
    'none',
    'none',
    'none',
    'workspace_resource',
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
