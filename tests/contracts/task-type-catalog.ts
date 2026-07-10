import { TASK_TYPE, type TaskType } from '@/lib/task/types'

export type TaskTestLayer = 'unit-helper' | 'worker-unit' | 'api-contract' | 'chain'

export type TaskTypeCoverageEntry = {
  taskType: TaskType
  owner: string
  layers: ReadonlyArray<TaskTestLayer>
}

const TASK_TYPE_OWNER_MAP = {
  [TASK_TYPE.IMAGE_PANEL]: 'tests/unit/worker/panel-image-task-handler.test.ts',
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: 'tests/unit/worker/edit-style-preview-image-task-handler.test.ts',
  [TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN]: 'tests/unit/edit-script/storyboard-consistency-model-generation.test.ts',
  [TASK_TYPE.IMAGE_CHARACTER]: 'tests/unit/worker/character-image-task-handler.test.ts',
  [TASK_TYPE.IMAGE_LOCATION]: 'tests/unit/worker/location-image-task-handler.test.ts',
  [TASK_TYPE.MUSIC_GENERATE]: 'tests/unit/worker/music-worker.test.ts',
  [TASK_TYPE.MUSIC_SCORE_PLAN]: 'tests/unit/worker/bgm-score-worker.test.ts',
  [TASK_TYPE.SOUNDSCAPE_PLAN]: 'tests/unit/worker/soundscape-worker.test.ts',
  [TASK_TYPE.SOUNDSCAPE_GENERATE]: 'tests/unit/worker/soundscape-worker.test.ts',
  [TASK_TYPE.FINAL_VIDEO_RENDER]: 'tests/unit/worker/final-video-render-worker.test.ts',
  [TASK_TYPE.CHAPTER_RENDER]: 'tests/unit/worker/chapter-render-worker.test.ts',
  [TASK_TYPE.VIDEO_PANEL]: 'tests/unit/worker/video-worker.test.ts',
  [TASK_TYPE.VIDEO_GROUP]: 'tests/unit/worker/video-worker.test.ts',
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: 'tests/unit/worker/image-task-handlers-core.test.ts',
  [TASK_TYPE.REGENERATE_GROUP]: 'tests/unit/worker/image-task-handlers-core.test.ts',
  [TASK_TYPE.ASSET_HUB_IMAGE]: 'tests/unit/worker/asset-hub-image-suffix.test.ts',
  [TASK_TYPE.ASSET_HUB_MODIFY]: 'tests/unit/worker/modify-image-reference-description.test.ts',
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: 'tests/unit/worker/edit-bible-generate.test.ts',
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: 'tests/unit/worker/edit-bible-generate.test.ts',
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: 'tests/unit/worker/edit-script-generate.test.ts',
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: 'tests/unit/worker/edit-script-structured-generate.test.ts',
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: 'tests/unit/worker/shot-ai-prompt-appearance.test.ts',
  [TASK_TYPE.AI_MODIFY_LOCATION]: 'tests/unit/worker/shot-ai-prompt-location.test.ts',
  [TASK_TYPE.AI_MODIFY_PROP]: 'tests/unit/helpers/prop-modify-task-registration.test.ts',
  [TASK_TYPE.AI_CREATE_CHARACTER]: 'tests/unit/worker/shot-ai-tasks.test.ts',
  [TASK_TYPE.AI_CREATE_LOCATION]: 'tests/unit/worker/shot-ai-tasks.test.ts',
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: 'tests/unit/worker/reference-to-character.test.ts',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: 'tests/unit/worker/asset-hub-ai-design.test.ts',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: 'tests/unit/worker/asset-hub-ai-design.test.ts',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: 'tests/unit/worker/asset-hub-ai-modify.test.ts',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: 'tests/unit/worker/asset-hub-ai-modify.test.ts',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: 'tests/unit/helpers/prop-modify-task-registration.test.ts',
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: 'tests/unit/worker/reference-to-character.test.ts',
} as const satisfies Record<TaskType, string>

export const TASK_TYPE_CATALOG: ReadonlyArray<TaskTypeCoverageEntry> = (Object.values(TASK_TYPE) as TaskType[])
  .map((taskType) => ({
    taskType,
    owner: TASK_TYPE_OWNER_MAP[taskType],
    layers: ['worker-unit', 'api-contract', 'chain'],
  }))

export const TASK_TYPE_COUNT = TASK_TYPE_CATALOG.length
