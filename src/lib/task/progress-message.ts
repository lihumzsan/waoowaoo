import { TASK_EVENT_TYPE, TASK_TYPE } from './types'

const TASK_TYPE_LABELS: Record<string, string> = {
  [TASK_TYPE.IMAGE_PANEL]: 'progress.taskType.imagePanel',
  [TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE]: 'progress.taskType.editStylePreviewsGenerate',
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: 'progress.taskType.editStylePreviewImage',
  [TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN]: 'progress.taskType.editScriptStoryboardCameraPlan',
  [TASK_TYPE.EDIT_IMAGE_PROMPT_COMPOSE]: 'progress.taskType.editImagePromptCompose',
  [TASK_TYPE.EDIT_VIDEO_PROMPT_COMPOSE]: 'progress.taskType.editVideoPromptCompose',
  [TASK_TYPE.IMAGE_CHARACTER]: 'progress.taskType.imageCharacter',
  [TASK_TYPE.IMAGE_LOCATION]: 'progress.taskType.imageLocation',
  [TASK_TYPE.MUSIC_GENERATE]: 'progress.taskType.musicGenerate',
  [TASK_TYPE.BGM_SCORE_GENERATE]: 'progress.taskType.bgmScoreGenerate',
  [TASK_TYPE.FINAL_VIDEO_RENDER]: 'progress.taskType.finalVideoRender',
  [TASK_TYPE.VIDEO_PANEL]: 'progress.taskType.videoPanel',
  [TASK_TYPE.VIDEO_GROUP]: 'progress.taskType.videoGroup',
  [TASK_TYPE.INSERT_PANEL]: 'progress.taskType.insertPanel',
  [TASK_TYPE.PANEL_VARIANT]: 'progress.taskType.panelVariant',
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: 'progress.taskType.modifyAssetImage',
  [TASK_TYPE.REGENERATE_GROUP]: 'progress.taskType.regenerateGroup',
  [TASK_TYPE.ASSET_HUB_IMAGE]: 'progress.taskType.assetHubImage',
  [TASK_TYPE.ASSET_HUB_MODIFY]: 'progress.taskType.assetHubModify',
  [TASK_TYPE.EDIT_SCREENPLAY_GENERATE]: 'progress.taskType.editScreenplayGenerate',
  [TASK_TYPE.EDIT_SCREENPLAY_REVISE]: 'progress.taskType.editScreenplayRevise',
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: 'progress.taskType.editScriptGenerate',
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: 'progress.taskType.editScriptGenerate',
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: 'progress.taskType.aiModifyAppearance',
  [TASK_TYPE.AI_MODIFY_LOCATION]: 'progress.taskType.aiModifyLocation',
  [TASK_TYPE.AI_MODIFY_PROP]: 'progress.taskType.aiModifyProp',
  [TASK_TYPE.AI_MODIFY_SHOT_PROMPT]: 'progress.taskType.aiModifyShotPrompt',
  [TASK_TYPE.ANALYZE_SHOT_VARIANTS]: 'progress.taskType.analyzeShotVariants',
  [TASK_TYPE.AI_CREATE_CHARACTER]: 'progress.taskType.aiCreateCharacter',
  [TASK_TYPE.AI_CREATE_LOCATION]: 'progress.taskType.aiCreateLocation',
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: 'progress.taskType.referenceToCharacter',
  [TASK_TYPE.EPISODE_SPLIT_LLM]: 'progress.taskType.episodeSplitLlm',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: 'progress.taskType.assetHubAiDesignCharacter',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: 'progress.taskType.assetHubAiDesignLocation',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: 'progress.taskType.assetHubAiModifyCharacter',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: 'progress.taskType.assetHubAiModifyLocation',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: 'progress.taskType.assetHubAiModifyProp',
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: 'progress.taskType.assetHubReferenceToCharacter',
}

const STAGE_LABELS: Record<string, string> = {
  received: 'progress.stage.received',
  generate_character_image: 'progress.stage.generateCharacterImage',
  generate_location_image: 'progress.stage.generateLocationImage',
  generate_panel_candidate: 'progress.stage.generatePanelCandidate',
  edit_style_previews_prepare: 'progress.stage.editStylePreviewsPrepare',
  edit_style_previews_generate_text: 'progress.stage.editStylePreviewsGenerateText',
  edit_style_previews_submit_images: 'progress.stage.editStylePreviewsSubmitImages',
  edit_style_previews_wait_images: 'progress.stage.editStylePreviewsWaitImages',
  edit_style_preview_image_prepare: 'progress.stage.editStylePreviewImagePrepare',
  edit_style_preview_image_generate: 'progress.stage.editStylePreviewImageGenerate',
  edit_style_preview_image_persist: 'progress.stage.editStylePreviewImagePersist',
  edit_script_storyboard_build_facts: 'progress.stage.editScriptStoryboardPrepare',
  edit_script_storyboard_camera_plan: 'progress.stage.editScriptStoryboardCameraPlan',
  edit_image_prompt_compose_prepare: 'progress.stage.editImagePromptComposePrepare',
  edit_image_prompt_compose_generate: 'progress.stage.editImagePromptComposeGenerate',
  edit_image_prompt_compose_persist: 'progress.stage.editImagePromptComposePersist',
  edit_video_prompt_compose_prepare: 'progress.stage.editVideoPromptComposePrepare',
  edit_video_prompt_compose_generate: 'progress.stage.editVideoPromptComposeGenerate',
  edit_video_prompt_compose_persist: 'progress.stage.editVideoPromptComposePersist',
  generate_panel_video: 'progress.stage.generatePanelVideo',
  video_group_prepare: 'progress.stage.videoGroupPrepare',
  video_group_prompt: 'progress.stage.videoGroupPrompt',
  video_group_generate: 'progress.stage.videoGroupGenerate',
  video_group_persist: 'progress.stage.videoGroupPersist',
  asset_reference_video_prepare: 'progress.stage.assetReferenceVideoPrepare',
  asset_reference_video_normalize: 'progress.stage.assetReferenceVideoNormalize',
  asset_reference_video_generate: 'progress.stage.assetReferenceVideoGenerate',
  asset_reference_video_persist: 'progress.stage.assetReferenceVideoPersist',
  generate_music_submit: 'progress.stage.generateMusicSubmit',
  persist_music: 'progress.stage.persistMusic',
  bgm_score_prepare: 'progress.stage.bgmScorePrepare',
  bgm_score_plan: 'progress.stage.bgmScorePlan',
  bgm_score_generate_music: 'progress.stage.bgmScoreGenerateMusic',
  bgm_score_persist: 'progress.stage.bgmScorePersist',
  final_render_prepare: 'progress.stage.finalRenderPrepare',
  final_render_music: 'progress.stage.finalRenderMusic',
  final_render_compose: 'progress.stage.finalRenderCompose',
  final_render_persist: 'progress.stage.finalRenderPersist',
  storyboard_clip: 'progress.stage.storyboardClip',
  regenerate_storyboard_prepare: 'progress.stage.regenerateStoryboardPrepare',
  regenerate_storyboard_persist: 'progress.stage.regenerateStoryboardPersist',
  insert_panel_generate_text: 'progress.stage.insertPanelGenerateText',
  insert_panel_persist: 'progress.stage.insertPanelPersist',
  polling_external: 'progress.stage.pollingExternal',
  enqueue_failed: 'progress.stage.enqueueFailed',
  llm_proxy_submit: 'progress.stage.llmProxySubmit',
  llm_proxy_execute: 'progress.stage.llmProxyExecute',
  llm_proxy_persist: 'progress.stage.llmProxyPersist',
  edit_screenplay_prepare: 'progress.stage.editScreenplayPrepare',
  edit_screenplay_generate: 'progress.stage.editScreenplayGenerate',
  edit_screenplay_persist: 'progress.stage.editScreenplayPersist',
  edit_screenplay_revision_prepare: 'progress.stage.editScreenplayRevisionPrepare',
  edit_screenplay_revision_generate: 'progress.stage.editScreenplayRevisionGenerate',
  edit_screenplay_revision_persist: 'progress.stage.editScreenplayRevisionPersist',
  edit_script_prepare: 'progress.stage.editScriptPrepare',
  edit_script_generate: 'progress.stage.editScriptGenerate',
  edit_script_primary: 'progress.stage.editScriptPrimary',
  edit_script_asset_extract: 'progress.stage.editScriptAssetExtract',
  edit_script_video_prompt: 'progress.stage.editScriptVideoPrompt',
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
