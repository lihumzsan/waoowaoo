export const AI_PROMPT_IDS = {
  PROJECT_AGENT_SYSTEM: 'project-agent-system',
  CHARACTER_CREATE: 'character-create',
  CHARACTER_MODIFY: 'character-modify',
  CHARACTER_UPDATE_DESCRIPTION: 'character-update-description',
  CHARACTER_REFERENCE_DESCRIBE_IMAGE: 'character-reference-describe-image',
  CHARACTER_REFERENCE_TO_SHEET: 'character-reference-to-sheet',
  LOCATION_CREATE: 'location-create',
  LOCATION_MODIFY: 'location-modify',
  LOCATION_SPATIAL_PROFILE: 'location-spatial-profile',
  LOCATION_UPDATE_DESCRIPTION: 'location-update-description',
  PROP_UPDATE_DESCRIPTION: 'prop-update-description',
  MUSIC_FINAL_RENDER_BGM: 'music-final-render-bgm',
  EDIT_SCRIPT_STYLE_BIBLE: 'style-bible',
  EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS: 'style-preview-options',
  EDIT_SCRIPT_SCREENPLAY: 'screenplay',
  EDIT_SCRIPT_SCREENPLAY_REVISION: 'screenplay-revision',
  EDIT_SCRIPT_STRUCTURE: 'structure',
  EDIT_SCRIPT_ASSET_EXTRACT: 'asset-extract',
  EDIT_SCRIPT_SHOT_EXECUTION_PLAN: 'shot-execution-plan',
} as const

export type AiPromptId = (typeof AI_PROMPT_IDS)[keyof typeof AI_PROMPT_IDS]
