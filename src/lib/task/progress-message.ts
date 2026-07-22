import { TASK_EVENT_TYPE, TASK_TYPE } from './types'

const TASK_TYPE_LABELS: Record<string, string> = {
  [TASK_TYPE.CREATIVE_WORK]: 'progress.taskType.creativeWork',
  [TASK_TYPE.CREATIVE_RESOURCE_IMAGE]: 'progress.taskType.creativeResourceImage',
  [TASK_TYPE.CREATIVE_RESOURCE_AUDIO]: 'progress.taskType.creativeResourceAudio',
  [TASK_TYPE.CREATIVE_RESOURCE_VOICE]: 'progress.taskType.creativeResourceVoice',
  [TASK_TYPE.CREATIVE_RESOURCE_VIDEO]: 'progress.taskType.creativeResourceVideo',
  [TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE]: 'progress.taskType.editStylePreviewOptionsGenerate',
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: 'progress.taskType.editStylePreviewImage',
  [TASK_TYPE.IMAGE_CHARACTER]: 'progress.taskType.imageCharacter',
  [TASK_TYPE.IMAGE_LOCATION]: 'progress.taskType.imageLocation',
  [TASK_TYPE.MUSIC_GENERATE]: 'progress.taskType.musicGenerate',
  [TASK_TYPE.BGM_DESIGN_PLAN]: 'progress.taskType.bgmDesignPlan',
  [TASK_TYPE.MUSIC_SCORE_GENERATE]: 'progress.taskType.musicScoreGenerate',
  [TASK_TYPE.FINAL_VIDEO_RENDER]: 'progress.taskType.finalVideoRender',
  [TASK_TYPE.VIDEO_SEGMENT]: 'progress.taskType.videoSegment',
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: 'progress.taskType.modifyAssetImage',
  [TASK_TYPE.REGENERATE_GROUP]: 'progress.taskType.regenerateGroup',
  [TASK_TYPE.ASSET_HUB_IMAGE]: 'progress.taskType.assetHubImage',
  [TASK_TYPE.ASSET_HUB_MODIFY]: 'progress.taskType.assetHubModify',
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: 'progress.taskType.editSourceScriptGenerate',
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: 'progress.taskType.editBibleGenerate',
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: 'progress.taskType.editScriptGenerate',
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: 'progress.taskType.editScriptGenerate',
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: 'progress.taskType.aiModifyAppearance',
  [TASK_TYPE.AI_MODIFY_LOCATION]: 'progress.taskType.aiModifyLocation',
  [TASK_TYPE.AI_MODIFY_PROP]: 'progress.taskType.aiModifyProp',
  [TASK_TYPE.AI_CREATE_CHARACTER]: 'progress.taskType.aiCreateCharacter',
  [TASK_TYPE.AI_CREATE_LOCATION]: 'progress.taskType.aiCreateLocation',
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: 'progress.taskType.referenceToCharacter',
  [TASK_TYPE.REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: 'progress.taskType.referenceToCharacter',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: 'progress.taskType.assetHubAiDesignCharacter',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: 'progress.taskType.assetHubAiDesignLocation',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: 'progress.taskType.assetHubAiModifyCharacter',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: 'progress.taskType.assetHubAiModifyLocation',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: 'progress.taskType.assetHubAiModifyProp',
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: 'progress.taskType.assetHubReferenceToCharacter',
  [TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: 'progress.taskType.assetHubReferenceToCharacter',
}

const STAGE_LABELS: Record<string, string> = {
  received: 'progress.stage.received',
  creative_work_prepare: 'progress.stage.creativeWorkPrepare',
  creative_work_reasoning: 'progress.stage.creativeWorkReasoning',
  creative_work_finalize: 'progress.stage.creativeWorkFinalize',
  creative_resource_prepare: 'progress.stage.creativeResourcePrepare',
  creative_resource_generate: 'progress.stage.creativeResourceGenerate',
  creative_resource_persist: 'progress.stage.creativeResourcePersist',
  generate_character_image: 'progress.stage.generateCharacterImage',
  generate_location_image: 'progress.stage.generateLocationImage',
  edit_style_preview_image_prepare: 'progress.stage.editStylePreviewImagePrepare',
  edit_style_preview_image_generate: 'progress.stage.editStylePreviewImageGenerate',
  edit_style_preview_image_persist: 'progress.stage.editStylePreviewImagePersist',
  edit_style_preview_options_prepare: 'progress.stage.editStylePreviewOptionsPrepare',
  edit_style_preview_options_generate: 'progress.stage.editStylePreviewOptionsGenerate',
  edit_style_preview_options_persist: 'progress.stage.editStylePreviewOptionsPersist',
  edit_source_script_prepare: 'progress.stage.editSourceScriptPrepare',
  edit_source_script_generate: 'progress.stage.editSourceScriptGenerate',
  video_segment_references: 'progress.stage.videoSegmentReferences',
  video_segment_generate: 'progress.stage.videoSegmentGenerate',
  video_segment_persist: 'progress.stage.videoSegmentPersist',
  generate_music_submit: 'progress.stage.generateMusicSubmit',
  persist_music: 'progress.stage.persistMusic',
  generate_voice_submit: 'progress.stage.generateVoiceSubmit',
  persist_voice: 'progress.stage.persistVoice',
  bgm_design_prepare: 'progress.stage.bgmDesignPrepare',
  bgm_design_plan: 'progress.stage.bgmDesignPlan',
  bgm_design_plan_persisted: 'progress.stage.bgmDesignPlanPersisted',
  bgm_score_generate_prepare: 'progress.stage.bgmScoreGeneratePrepare',
  bgm_score_generate_music: 'progress.stage.bgmScoreGenerateMusic',
  bgm_score_persist: 'progress.stage.bgmScorePersist',
  final_render_prepare: 'progress.stage.finalRenderPrepare',
  final_render_music: 'progress.stage.finalRenderMusic',
  final_render_compose: 'progress.stage.finalRenderCompose',
  final_render_persist: 'progress.stage.finalRenderPersist',
  polling_external: 'progress.stage.pollingExternal',
  retrying: 'progress.stage.retrying',
  enqueue_failed: 'progress.stage.enqueueFailed',
  llm_proxy_submit: 'progress.stage.llmProxySubmit',
  llm_proxy_execute: 'progress.stage.llmProxyExecute',
  llm_proxy_persist: 'progress.stage.llmProxyPersist',
  edit_bible_prepare: 'progress.stage.editBiblePrepare',
  edit_bible_generate: 'progress.stage.editBibleGenerate',
  edit_bible_persist: 'progress.stage.editBiblePersist',
  edit_bible_revision_prepare: 'progress.stage.editBibleRevisionPrepare',
  edit_bible_revision_generate: 'progress.stage.editBibleRevisionGenerate',
  edit_bible_revision_persist: 'progress.stage.editBibleRevisionPersist',
  edit_script_prepare: 'progress.stage.editScriptPrepare',
  edit_script_generate: 'progress.stage.editScriptGenerate',
  edit_script_primary: 'progress.stage.editScriptPrimary',
  edit_script_asset_extract: 'progress.stage.editScriptAssetExtract',
  edit_script_persist: 'progress.stage.editScriptPersist',
  edit_shot_execution_plan_prepare: 'progress.stage.editScriptPrepare',
  edit_shot_execution_plan_generate: 'progress.stage.editScriptGenerate',
  edit_shot_execution_plan_persist: 'progress.stage.editScriptPersist',
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
