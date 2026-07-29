import { getTaskTypeLabel } from '@/lib/task/progress-message'

export type LLMTaskPipelineStage = {
  id: string
  taskType: string
  title: string
}

export type LLMTaskPipeline = {
  id: string
  stages: LLMTaskPipelineStage[]
}

export type LLMTaskFlowMeta = {
  flowId: string
  flowStageIndex: number
  flowStageTotal: number
  flowStageTitle: string
}

function createSingleStageMeta(taskType: string): LLMTaskFlowMeta {
  return {
    flowId: `single:${taskType}`,
    flowStageIndex: 1,
    flowStageTotal: 1,
    flowStageTitle: getTaskTypeLabel(taskType),
  }
}

function createSingleStagePipeline(taskType: string): LLMTaskPipeline {
  const meta = createSingleStageMeta(taskType)
  return {
    id: meta.flowId,
    stages: [
      {
        id: taskType,
        taskType,
        title: meta.flowStageTitle,
      },
    ],
  }
}

export function getTaskFlowMeta(taskType: string | null | undefined): LLMTaskFlowMeta {
  return createSingleStageMeta(taskType || 'llm_task')
}

export function getTaskPipelineByFlowId(
  flowId: string | null | undefined,
  fallbackTaskType: string | null | undefined,
): LLMTaskPipeline {
  if (!flowId) return createSingleStagePipeline(fallbackTaskType || 'llm_task')
  return createSingleStagePipeline(fallbackTaskType || flowId)
}

export function getTaskPipeline(taskType: string | null | undefined): LLMTaskPipeline {
  const meta = getTaskFlowMeta(taskType)
  return getTaskPipelineByFlowId(meta.flowId, taskType)
}
