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

type LLMTaskFlowDefinition = {
  id: string
  stages: LLMTaskPipelineStage[]
}

const FLOW_DEFINITIONS: ReadonlyArray<LLMTaskFlowDefinition> = []

const FLOW_BY_ID: Record<string, LLMTaskFlowDefinition> = FLOW_DEFINITIONS.reduce(
  (acc, flow) => {
    acc[flow.id] = flow
    return acc
  },
  {} as Record<string, LLMTaskFlowDefinition>,
)

const FLOW_META_BY_TASK_TYPE: Record<string, LLMTaskFlowMeta> = FLOW_DEFINITIONS.reduce(
  (acc, flow) => {
    flow.stages.forEach((stage, index) => {
      acc[stage.taskType] = {
        flowId: flow.id,
        flowStageIndex: index + 1,
        flowStageTotal: flow.stages.length,
        flowStageTitle: stage.title,
      }
    })
    return acc
  },
  {} as Record<string, LLMTaskFlowMeta>,
)

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

function clonePipeline(pipeline: LLMTaskPipeline): LLMTaskPipeline {
  return {
    id: pipeline.id,
    stages: pipeline.stages.map((stage) => ({ ...stage })),
  }
}

export function getTaskFlowMeta(taskType: string | null | undefined): LLMTaskFlowMeta {
  if (!taskType) return createSingleStageMeta('llm_task')
  return FLOW_META_BY_TASK_TYPE[taskType] || createSingleStageMeta(taskType)
}

export function getTaskPipelineByFlowId(
  flowId: string | null | undefined,
  fallbackTaskType: string | null | undefined,
): LLMTaskPipeline {
  if (!flowId) return createSingleStagePipeline(fallbackTaskType || 'llm_task')
  const pipeline = FLOW_BY_ID[flowId]
  if (!pipeline) {
    return createSingleStagePipeline(fallbackTaskType || flowId)
  }
  return clonePipeline(pipeline)
}

export function getTaskPipeline(taskType: string | null | undefined): LLMTaskPipeline {
  const meta = getTaskFlowMeta(taskType)
  return getTaskPipelineByFlowId(meta.flowId, taskType)
}
