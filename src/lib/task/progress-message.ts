import { TASK_EVENT_TYPE, TASK_TYPE } from './types'

const TASK_TYPE_LABELS: Record<string, string> = {
  [TASK_TYPE.IMAGE_PANEL]: 'progress.taskType.imagePanel',
  [TASK_TYPE.IMAGE_EPISODE_COVER]: 'progress.taskType.episodeCoverImage',
  [TASK_TYPE.IMAGE_CHARACTER]: 'progress.taskType.imageCharacter',
  [TASK_TYPE.IMAGE_LOCATION]: 'progress.taskType.imageLocation',
  [TASK_TYPE.VIDEO_PANEL]: 'progress.taskType.videoPanel',
  [TASK_TYPE.VIDEO_SEAM_CONCAT]: 'progress.taskType.videoSeamConcat',
  [TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE]: 'progress.taskType.environmentSoundAnalyze',
  [TASK_TYPE.ENVIRONMENT_SOUND_GENERATE]: 'progress.taskType.environmentSoundGenerate',
  [TASK_TYPE.ENVIRONMENT_SOUND_CLEANUP]: 'progress.taskType.environmentSoundCleanup',
  [TASK_TYPE.LIP_SYNC]: 'progress.taskType.lipSync',
  [TASK_TYPE.VOICE_LINE]: 'progress.taskType.voiceLine',
  [TASK_TYPE.FREE_VOICE]: 'progress.taskType.freeVoice',
  [TASK_TYPE.VOICE_DESIGN]: 'progress.taskType.voiceDesign',
  [TASK_TYPE.ASSET_HUB_VOICE_DESIGN]: 'progress.taskType.assetHubVoiceDesign',
  [TASK_TYPE.REGENERATE_STORYBOARD_TEXT]: 'progress.taskType.regenerateStoryboardText',
  [TASK_TYPE.INSERT_PANEL]: 'progress.taskType.insertPanel',
  [TASK_TYPE.PANEL_VARIANT]: 'progress.taskType.panelVariant',
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: 'progress.taskType.modifyAssetImage',
  [TASK_TYPE.REGENERATE_GROUP]: 'progress.taskType.regenerateGroup',
  [TASK_TYPE.ASSET_HUB_IMAGE]: 'progress.taskType.assetHubImage',
  [TASK_TYPE.ASSET_HUB_MODIFY]: 'progress.taskType.assetHubModify',
  [TASK_TYPE.ANALYZE_NOVEL]: 'progress.taskType.analyzeNovel',
  [TASK_TYPE.STORY_TO_SCRIPT_RUN]: 'progress.taskType.storyToScriptRun',
  [TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN]: 'progress.taskType.scriptToStoryboardRun',
  [TASK_TYPE.CLIPS_BUILD]: 'progress.taskType.clipsBuild',
  [TASK_TYPE.SCREENPLAY_CONVERT]: 'progress.taskType.screenplayConvert',
  [TASK_TYPE.VOICE_ANALYZE]: 'progress.taskType.voiceAnalyze',
  [TASK_TYPE.ANALYZE_GLOBAL]: 'progress.taskType.analyzeGlobal',
  [TASK_TYPE.AI_STORY_EXPAND]: 'progress.taskType.aiStoryExpand',
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: 'progress.taskType.aiModifyAppearance',
  [TASK_TYPE.AI_MODIFY_LOCATION]: 'progress.taskType.aiModifyLocation',
  [TASK_TYPE.AI_MODIFY_PROP]: 'progress.taskType.aiModifyProp',
  [TASK_TYPE.AI_MODIFY_SHOT_PROMPT]: 'progress.taskType.aiModifyShotPrompt',
  [TASK_TYPE.ANALYZE_SHOT_VARIANTS]: 'progress.taskType.analyzeShotVariants',
  [TASK_TYPE.AI_CREATE_CHARACTER]: 'progress.taskType.aiCreateCharacter',
  [TASK_TYPE.AI_CREATE_LOCATION]: 'progress.taskType.aiCreateLocation',
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: 'progress.taskType.referenceToCharacter',
  [TASK_TYPE.CHARACTER_PROFILE_CONFIRM]: 'progress.taskType.characterProfileConfirm',
  [TASK_TYPE.CHARACTER_PROFILE_BATCH_CONFIRM]: 'progress.taskType.characterProfileBatchConfirm',
  [TASK_TYPE.EPISODE_SPLIT_LLM]: 'progress.taskType.episodeSplitLlm',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: 'progress.taskType.assetHubAiDesignCharacter',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: 'progress.taskType.assetHubAiDesignLocation',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: 'progress.taskType.assetHubAiModifyCharacter',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: 'progress.taskType.assetHubAiModifyLocation',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: 'progress.taskType.assetHubAiModifyProp',
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: 'progress.taskType.assetHubReferenceToCharacter',
  [TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT]: 'progress.taskType.generateFirstLastFramePrompt',
}

const STAGE_LABELS: Record<string, string> = {
  received: 'progress.stage.received',
  generate_character_image: 'progress.stage.generateCharacterImage',
  generate_location_image: 'progress.stage.generateLocationImage',
  generate_panel_candidate: 'progress.stage.generatePanelCandidate',
  generate_episode_cover: 'progress.stage.generateEpisodeCover',
  persist_episode_cover: 'progress.stage.persistEpisodeCover',
  generate_panel_video: 'progress.stage.generatePanelVideo',
  prepare_inputs: 'videoTools.status.preparing',
  comfyui_processing: 'videoTools.status.processing',
  persist_output: 'videoTools.status.persisting',
  environment_sound_prepare: 'progress.stage.environmentSoundPrepare',
  environment_sound_analyze: 'progress.stage.environmentSoundAnalyze',
  environment_sound_plan_ready: 'progress.stage.environmentSoundPlanReady',
  environment_sound_generate: 'progress.stage.environmentSoundGenerate',
  environment_sound_compose: 'progress.stage.environmentSoundCompose',
  environment_sound_persist: 'progress.stage.environmentSoundPersist',
  generate_voice_submit: 'progress.stage.generateVoiceSubmit',
  generate_voice_persist: 'progress.stage.generateVoicePersist',
  generate_free_voice_submit: 'progress.stage.generateFreeVoiceSubmit',
  generate_free_voice_persist: 'progress.stage.generateFreeVoicePersist',
  voice_design_submit: 'progress.stage.voiceDesignSubmit',
  voice_design_done: 'progress.stage.voiceDesignDone',
  submit_lip_sync: 'progress.stage.submitLipSync',
  persist_lip_sync: 'progress.stage.persistLipSync',
  storyboard_clip: 'progress.stage.storyboardClip',
  regenerate_storyboard_prepare: 'progress.stage.regenerateStoryboardPrepare',
  regenerate_storyboard_persist: 'progress.stage.regenerateStoryboardPersist',
  story_to_script_prepare: 'progress.stage.storyToScriptPrepare',
  story_to_script_step: 'progress.stage.storyToScriptStep',
  story_to_script_persist: 'progress.stage.storyToScriptPersist',
  story_to_script_persist_done: 'progress.stage.storyToScriptPersistDone',
  script_to_storyboard_prepare: 'progress.stage.scriptToStoryboardPrepare',
  script_to_storyboard_step: 'progress.stage.scriptToStoryboardStep',
  script_to_storyboard_persist: 'progress.stage.scriptToStoryboardPersist',
  script_to_storyboard_persist_done: 'progress.stage.scriptToStoryboardPersistDone',
  ai_story_expand_prepare: 'progress.stage.aiStoryExpandPrepare',
  ai_story_expand_done: 'progress.stage.aiStoryExpandDone',
  insert_panel_generate_text: 'progress.stage.insertPanelGenerateText',
  insert_panel_persist: 'progress.stage.insertPanelPersist',
  polling_external: 'progress.stage.pollingExternal',
  enqueue_failed: 'progress.stage.enqueueFailed',
  llm_proxy_submit: 'progress.stage.llmProxySubmit',
  llm_proxy_execute: 'progress.stage.llmProxyExecute',
  llm_proxy_persist: 'progress.stage.llmProxyPersist',
  first_last_frame_prompt_prepare: 'progress.stage.firstLastFramePromptPrepare',
  first_last_frame_prompt_generate: 'progress.stage.firstLastFramePromptGenerate',
  first_last_frame_prompt_persist: 'progress.stage.firstLastFramePromptPersist',
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
