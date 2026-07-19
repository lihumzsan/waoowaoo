import { AI_PROMPT_IDS, type AiPromptId } from './ids'
import type { AiPromptCatalogEntry } from './types'

export const AI_PROMPT_CATALOG: Record<AiPromptId, AiPromptCatalogEntry> = {
  [AI_PROMPT_IDS.PROJECT_AGENT_SYSTEM]: {
    pathStem: 'project-agent/system',
    variableKeys: ['project_id', 'episode_id'],
  },
  [AI_PROMPT_IDS.PROJECT_AGENT_SCRIPT_INTAKE]: {
    pathStem: 'project-agent/script-intake',
    variableKeys: ['seed_text'],
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
    variableKeys: ['user_request', 'bible_text', 'duration_guidance', 'style_direction', 'style_preview_count'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE]: {
    pathStem: 'edit-script/structure',
    variableKeys: [
      'user_request',
      'bible_text',
      'story_bible_json',
      'entry_snapshot_json',
      'chapter_events_json',
      'asset_menu_json',
      'duration_guidance',
      'generation_segment_max_duration_seconds',
      'aspect_ratio',
      'style_bible_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN]: {
    pathStem: 'edit-script/shot-execution-plan',
    variableKeys: [
      'structure_json',
      'visual_style',
      'aspect_ratio',
    ],
  },
  [AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT]: {
    pathStem: 'edit-bible/outline-script',
    variableKeys: ['user_prompt'],
  },
  [AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL]: {
    pathStem: 'edit-bible/global-bible',
    variableKeys: ['source_document', 'source_length'],
  },
  [AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET]: {
    pathStem: 'edit-bible/beat-sheet',
    variableKeys: ['source_document', 'source_length'],
  },
  [AI_PROMPT_IDS.EDIT_BIBLE_LEDGER]: {
    pathStem: 'edit-bible/ledger',
    variableKeys: ['source_document', 'source_length', 'beat_sheet', 'entity_catalog'],
  },
  [AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE]: {
    pathStem: 'edit-bible/emotional-curve',
    variableKeys: ['source_document', 'source_length'],
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
