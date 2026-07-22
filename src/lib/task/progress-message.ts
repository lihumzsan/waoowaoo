import { TASK_EVENT_TYPE, TASK_TYPE } from './types'

const TASK_TYPE_LABELS: Record<string, string> = {
  [TASK_TYPE.CREATIVE_WORK]: 'progress.taskType.creativeWork',
  [TASK_TYPE.CREATIVE_RESOURCE_IMAGE]: 'progress.taskType.creativeResourceImage',
  [TASK_TYPE.CREATIVE_RESOURCE_AUDIO]: 'progress.taskType.creativeResourceAudio',
  [TASK_TYPE.CREATIVE_RESOURCE_VOICE]: 'progress.taskType.creativeResourceVoice',
  [TASK_TYPE.CREATIVE_RESOURCE_VIDEO]: 'progress.taskType.creativeResourceVideo',
  [TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE]: 'progress.taskType.creativeResourceVideoMerge',
}

const STAGE_LABELS: Record<string, string> = {
  received: 'progress.stage.received',
  creative_work_prepare: 'progress.stage.creativeWorkPrepare',
  creative_work_reasoning: 'progress.stage.creativeWorkReasoning',
  creative_work_finalize: 'progress.stage.creativeWorkFinalize',
  creative_resource_prepare: 'progress.stage.creativeResourcePrepare',
  creative_resource_generate: 'progress.stage.creativeResourceGenerate',
  creative_resource_persist: 'progress.stage.creativeResourcePersist',
  generate_voice_submit: 'progress.stage.generateVoiceSubmit',
  persist_voice: 'progress.stage.persistVoice',
  polling_external: 'progress.stage.pollingExternal',
  retrying: 'progress.stage.retrying',
  enqueue_failed: 'progress.stage.enqueueFailed',
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function getTaskTypeLabel(taskType?: string | null) {
  if (!taskType) return 'progress.taskType.generic'
  return TASK_TYPE_LABELS[taskType] || 'progress.taskType.generic'
}

export function getTaskStageLabel(stage?: string | null) {
  if (!stage) return null
  return STAGE_LABELS[stage] || stage
}

export function buildTaskProgressMessage(params: {
  eventType?: string | null
  taskType?: string | null
  progress?: number | null
  payload?: Record<string, unknown> | null
}) {
  const payloadMessage = asString(params.payload?.message)
  if (payloadMessage) return payloadMessage

  const stage = asString(params.payload?.stage)
  const stageLabel = getTaskStageLabel(stage)

  if (params.eventType === TASK_EVENT_TYPE.CREATED) {
    return 'progress.runtime.taskCreated'
  }
  if (params.eventType === TASK_EVENT_TYPE.PROCESSING) {
    return stageLabel || 'progress.runtime.taskStarted'
  }
  if (params.eventType === TASK_EVENT_TYPE.COMPLETED) {
    return 'progress.runtime.taskCompleted'
  }
  if (params.eventType === TASK_EVENT_TYPE.FAILED) {
    return 'progress.runtime.taskFailed'
  }

  return stageLabel || 'progress.runtime.taskProcessing'
}
