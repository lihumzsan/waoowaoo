import { AI_PROMPT_IDS, type AiPromptId } from './ids'
import type { AiPromptCatalogEntry } from './types'

export const AI_PROMPT_CATALOG: Record<AiPromptId, AiPromptCatalogEntry> = {
  [AI_PROMPT_IDS.PROJECT_AGENT_SYSTEM]: {
    pathStem: 'project-agent/system',
    variableKeys: ['assistant_permission_mode', 'project_id', 'episode_id'],
  },
  [AI_PROMPT_IDS.CHARACTER_CREATE]: {
    pathStem: 'character/create',
    variableKeys: ['user_input'],
  },
  [AI_PROMPT_IDS.CHARACTER_MODIFY]: {
    pathStem: 'character/modify',
    variableKeys: ['character_input', 'user_input'],
  },
  [AI_PROMPT_IDS.CHARACTER_UPDATE_DESCRIPTION]: {
    pathStem: 'character/update-description',
    variableKeys: ['original_description', 'modify_instruction', 'image_context'],
  },
  [AI_PROMPT_IDS.CHARACTER_REFERENCE_DESCRIBE_IMAGE]: {
    pathStem: 'character/reference/describe-image',
    variableKeys: [],
  },
  [AI_PROMPT_IDS.CHARACTER_REFERENCE_TO_SHEET]: {
    pathStem: 'character/reference/to-sheet',
    variableKeys: [],
  },
  [AI_PROMPT_IDS.LOCATION_CREATE]: {
    pathStem: 'location/create',
    variableKeys: ['user_input'],
  },
  [AI_PROMPT_IDS.LOCATION_MODIFY]: {
    pathStem: 'location/modify',
    variableKeys: ['location_name', 'location_input', 'user_input'],
  },
  [AI_PROMPT_IDS.LOCATION_SPATIAL_PROFILE]: {
    pathStem: 'location/spatial-profile',
    variableKeys: ['location_name', 'location_description'],
  },
  [AI_PROMPT_IDS.LOCATION_UPDATE_DESCRIPTION]: {
    pathStem: 'location/update-description',
    variableKeys: ['location_name', 'original_description', 'modify_instruction', 'image_context'],
  },
  [AI_PROMPT_IDS.PROP_UPDATE_DESCRIPTION]: {
    pathStem: 'prop/update-description',
    variableKeys: ['prop_name', 'original_description', 'modify_instruction', 'image_context'],
  },
  [AI_PROMPT_IDS.MUSIC_FINAL_RENDER_BGM]: {
    pathStem: 'music/final-render-bgm',
    variableKeys: [
      'title',
      'story_context',
      'duration_seconds',
      'project_context_json',
      'edit_script_json',
      'rendered_timeline_json',
      'timeline_map',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE]: {
    pathStem: 'edit-script/style-bible',
    variableKeys: ['user_request', 'duration_guidance', 'aspect_ratio', 'style_context_json'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS]: {
    pathStem: 'edit-script/style-preview-options',
    variableKeys: ['user_request', 'screenplay_text', 'duration_guidance', 'style_direction', 'style_preview_count'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY]: {
    pathStem: 'edit-script/screenplay',
    variableKeys: ['user_request', 'duration_guidance', 'aspect_ratio'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION]: {
    pathStem: 'edit-script/screenplay-revision',
    variableKeys: ['original_user_request', 'current_screenplay_text', 'revision_instruction', 'duration_guidance', 'aspect_ratio'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE]: {
    pathStem: 'edit-script/structure',
    variableKeys: [
      'user_request',
      'screenplay_text',
      'duration_guidance',
      'generation_segment_max_duration_seconds',
      'aspect_ratio',
      'style_bible_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT]: {
    pathStem: 'edit-script/asset-extract',
    variableKeys: ['structure_json'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN]: {
    pathStem: 'edit-script/shot-execution-plan',
    variableKeys: [
      'style_bible_json',
      'structure_json',
      'asset_context_json',
      'spatial_profiles_json',
    ],
  },
}

const OPERATION_TO_AI_PROMPT_ID = new Map<string, AiPromptId>()

for (const [promptId, entry] of Object.entries(AI_PROMPT_CATALOG) as Array<[AiPromptId, AiPromptCatalogEntry]>) {
  for (const operationId of entry.operationIds ?? []) {
    OPERATION_TO_AI_PROMPT_ID.set(operationId, promptId)
  }
}

export function resolveAiPromptIdFromOperationId(operationId: string): AiPromptId {
  const resolved = OPERATION_TO_AI_PROMPT_ID.get(operationId)
  if (!resolved) {
    throw new Error(`AI_PROMPT_OPERATION_UNREGISTERED:${operationId}`)
  }
  return resolved
}
