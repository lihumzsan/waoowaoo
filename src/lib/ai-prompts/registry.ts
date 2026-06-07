import { AI_PROMPT_IDS, type AiPromptId } from './ids'
import type { AiPromptCatalogEntry } from './types'

export const AI_PROMPT_CATALOG: Record<AiPromptId, AiPromptCatalogEntry> = {
  [AI_PROMPT_IDS.CHARACTER_ANALYZE]: {
    pathStem: 'character/analyze',
    variableKeys: ['input', 'characters_lib_info', 'style_bible'],
    operationIds: ['analyze_characters'],
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
  [AI_PROMPT_IDS.LOCATION_ANALYZE]: {
    pathStem: 'location/analyze',
    variableKeys: ['input', 'locations_lib_name'],
    operationIds: ['analyze_locations'],
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
  [AI_PROMPT_IDS.PROP_ANALYZE]: {
    pathStem: 'prop/analyze',
    variableKeys: ['input', 'props_lib_name'],
    operationIds: ['analyze_props'],
  },
  [AI_PROMPT_IDS.PROP_UPDATE_DESCRIPTION]: {
    pathStem: 'prop/update-description',
    variableKeys: ['prop_name', 'original_description', 'modify_instruction', 'image_context'],
  },
  [AI_PROMPT_IDS.SCRIPT_CLIP_SEGMENTS]: {
    pathStem: 'script/clip-segments',
    variableKeys: ['input', 'locations_lib_name', 'characters_lib_name', 'props_lib_name', 'characters_introduction'],
    operationIds: ['split_clips'],
  },
  [AI_PROMPT_IDS.SCRIPT_EPISODE_SPLIT]: {
    pathStem: 'script/episode-split',
    variableKeys: ['CONTENT'],
  },
  [AI_PROMPT_IDS.SCRIPT_GENERATE_SCREENPLAY]: {
    pathStem: 'script/generate-screenplay',
    variableKeys: ['clip_content', 'locations_lib_name', 'characters_lib_name', 'props_lib_name', 'characters_introduction', 'clip_id'],
    operationIds: ['write_screenplay'],
  },
  [AI_PROMPT_IDS.STORYBOARD_PLAN]: {
    pathStem: 'storyboard/plan',
    variableKeys: [
      'characters_lib_name',
      'locations_lib_name',
      'characters_introduction',
      'characters_appearance_list',
      'characters_full_description',
      'props_description',
      'clip_json',
      'clip_content',
    ],
    operationIds: ['create_shot_plan'],
  },
  [AI_PROMPT_IDS.STORYBOARD_REFINE_CINEMATOGRAPHY]: {
    pathStem: 'storyboard/refine-cinematography',
    variableKeys: ['panels_json', 'panel_count', 'locations_description', 'characters_info', 'props_description'],
    operationIds: ['refine_cinematography'],
  },
  [AI_PROMPT_IDS.STORYBOARD_REFINE_ACTING]: {
    pathStem: 'storyboard/refine-acting',
    variableKeys: ['panels_json', 'panel_count', 'characters_info'],
    operationIds: ['refine_acting'],
  },
  [AI_PROMPT_IDS.STORYBOARD_REFINE_DETAIL]: {
    pathStem: 'storyboard/refine-detail',
    variableKeys: ['panels_json', 'characters_age_gender', 'locations_description', 'props_description'],
    operationIds: ['finalize_storyboard'],
  },
  [AI_PROMPT_IDS.STORYBOARD_INSERT_PANEL]: {
    pathStem: 'storyboard/insert-panel',
    variableKeys: [
      'prev_panel_json',
      'next_panel_json',
      'characters_full_description',
      'locations_description',
      'props_description',
      'user_input',
    ],
  },
  [AI_PROMPT_IDS.SHOT_VARIANT_ANALYZE]: {
    pathStem: 'storyboard/shot-variant-analysis',
    variableKeys: ['panel_description', 'shot_type', 'camera_move', 'location', 'characters_info'],
  },
  [AI_PROMPT_IDS.SHOT_VARIANT_GENERATE]: {
    pathStem: 'storyboard/shot-variant-generate',
    variableKeys: [
      'original_description',
      'original_shot_type',
      'original_camera_move',
      'location',
      'characters_info',
      'variant_title',
      'variant_description',
      'target_shot_type',
      'target_camera_move',
      'video_prompt',
      'character_assets',
      'location_asset',
      'reference_images',
      'aspect_ratio',
      'style',
    ],
  },
  [AI_PROMPT_IDS.PANEL_IMAGE_GENERATE]: {
    pathStem: 'image/panel-generate',
    variableKeys: ['storyboard_text_json_input', 'source_text', 'aspect_ratio', 'style'],
  },
  [AI_PROMPT_IDS.IMAGE_UPDATE_SHOT_PROMPT]: {
    pathStem: 'image/update-shot-prompt',
    variableKeys: ['prompt_input', 'user_input', 'video_prompt_input'],
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
    variableKeys: ['user_request', 'duration_seconds', 'aspect_ratio', 'project_style_json'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS]: {
    pathStem: 'edit-script/style-preview-options',
    variableKeys: ['user_request', 'screenplay_text', 'duration_seconds'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY]: {
    pathStem: 'edit-script/screenplay',
    variableKeys: ['user_request', 'duration_seconds'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_DIRECTOR_DECOUPAGE]: {
    pathStem: 'edit-script/director-decoupage',
    variableKeys: ['user_request', 'screenplay_text', 'style_bible_json', 'duration_seconds', 'aspect_ratio'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY]: {
    pathStem: 'edit-script/primary',
    variableKeys: [
      'user_request',
      'screenplay_text',
      'director_decoupage_json',
      'duration_seconds',
      'aspect_ratio',
      'style_bible_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT]: {
    pathStem: 'edit-script/asset-extract',
    variableKeys: ['edit_script_json'],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK]: {
    pathStem: 'edit-script/video-prompt-block',
    variableKeys: [
      'user_request',
      'screenplay_text',
      'video_block_json',
      'block_shots_json',
      'asset_context_json',
      'adjacent_blocks_json',
      'aspect_ratio',
      'style_bible_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT]: {
    pathStem: 'edit-script/video-block-arrangement',
    variableKeys: [
      'user_request',
      'screenplay_text',
      'previous_video_blocks_json',
      'draft_video_blocks_json',
      'changed_video_blocks_json',
      'changed_block_shots_json',
      'asset_context_json',
      'aspect_ratio',
      'style_bible_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_BLOCK_MERGE]: {
    pathStem: 'edit-script/video-block-merge',
    variableKeys: [
      'user_request',
      'screenplay_text',
      'merged_video_block_json',
      'source_video_blocks_json',
      'merged_block_shots_json',
      'asset_context_json',
      'adjacent_blocks_json',
      'aspect_ratio',
      'style_bible_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL]: {
    pathStem: 'edit-script/storyboard-panel',
    variableKeys: [
      'shot_json',
      'video_block_json',
      'character_assets_json',
      'location_assets_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_CINEMATOGRAPHY_SHOT_PLAN]: {
    pathStem: 'edit-script/cinematography-shot-plan',
    variableKeys: [
      'style_bible_json',
      'director_decoupage_json',
      'edit_script_json',
      'asset_context_json',
      'spatial_profiles_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_CAMERA_STYLE_BIBLE]: {
    pathStem: 'edit-script/storyboard-camera-style-bible',
    variableKeys: [
      'source_snapshot_json',
      'spatial_profile_strategy_output_json',
    ],
  },
  [AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK]: {
    pathStem: 'edit-script/storyboard-panel-final-prompt-block',
    variableKeys: [
      'director_decoupage_json',
      'cinematography_shot_plan_json',
      'full_edit_script_json',
      'source_snapshot_json',
      'spatial_profile_strategy_output_json',
      'video_block_json',
      'block_shots_json',
      'adjacent_blocks_json',
      'previous_block_json',
      'next_block_json',
      'panel_contract_json',
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
