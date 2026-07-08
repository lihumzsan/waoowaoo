import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import { z } from 'zod'
import {
  editShotExecutionPlanSchema,
  EDIT_CHARACTER_ROLES,
  EDIT_CHARACTER_VISIBILITIES,
  EDIT_SHOT_PURPOSES,
  type EditShotExecution,
  type EditScriptShot,
} from '@/lib/edit-script/types'
import {
  bgmScoreDesignSectionSchema,
  bgmScorePromptSectionSchema,
  bgmScoreVirtualLayerSchema,
  type BgmScoreDesignSection,
  type BgmScorePromptSection,
  type BgmScoreVirtualLayer,
} from '@/lib/bgm-score/types'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'

const editShotExecutionPlanShotSchema = editShotExecutionPlanSchema.shape.shots.element
const editScriptStreamShotSchema = z.object({
  shotId: z.string().trim().min(1),
  shotNumber: z.number().int().positive(),
  shotPurpose: z.enum(EDIT_SHOT_PURPOSES).optional(),
  durationSec: z.number().int().min(1).max(5),
  scene: z.object({
    locationId: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    subScene: z.string().trim().min(1),
  }).strict(),
  action: z.string().trim().min(1),
  characters: z.array(z.object({
    characterId: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    visibility: z.enum(EDIT_CHARACTER_VISIBILITIES),
    role: z.enum(EDIT_CHARACTER_ROLES),
    performance: z.string().trim().min(1),
  }).strict()).min(0).max(20),
  keyObjects: z.array(z.object({
    name: z.string().trim().min(1),
    role: z.string().trim().min(1),
  }).strict()).min(0).max(20),
  sound: z.string().trim().min(1),
}).strict()

function parseEditScriptStreamShot(value: unknown): EditScriptShot {
  const shot = editScriptStreamShotSchema.parse(value)
  return {
    ...shot,
    shotPurpose: shot.shotPurpose ?? 'action',
    scene: {
      locationId: shot.scene.locationId,
      name: shot.scene.name ?? shot.scene.locationId,
      subScene: shot.scene.subScene,
    },
    characters: shot.characters.map((character) => ({
      ...character,
      name: character.name ?? character.characterId,
    })),
  }
}

export interface StructuredStreamTaskEventMeta {
  readonly taskType: string | null
  readonly stepId: string | null
}

export type StructuredStreamAdapterKey =
  | 'editScript.shots'
  | 'shotExecutionPlan.shots'
  | 'bgm.scoreDesign.sections'
  | 'bgm.promptSections'
  | 'bgm.virtualLayers'

export type TextStreamAdapterKey =
  | 'editBible.text'

export type StructuredStreamParsedItem =
  | {
    readonly kind: 'editScriptShot'
    readonly shot: EditScriptShot
  }
  | {
    readonly kind: 'shotExecutionPlanShot'
    readonly shot: EditShotExecution
  }
  | {
    readonly kind: 'bgmDesignSection'
    readonly section: BgmScoreDesignSection
  }
  | {
    readonly kind: 'bgmPromptSection'
    readonly section: BgmScorePromptSection
  }
  | {
    readonly kind: 'bgmVirtualLayer'
    readonly layer: BgmScoreVirtualLayer
  }

export interface StructuredStreamItem {
  readonly adapterKey: StructuredStreamAdapterKey
  readonly itemKey: string
  readonly value: StructuredStreamParsedItem
  readonly index: number
}

export interface StructuredStreamAdapter {
  readonly key: StructuredStreamAdapterKey
  readonly taskTypes: readonly TaskType[]
  readonly stepIds: readonly string[]
  readonly mode: 'array' | 'object'
  readonly path: readonly string[]
  readonly parseItem: (value: unknown) => StructuredStreamParsedItem
  readonly itemKey: (item: StructuredStreamParsedItem, fallbackIndex: number) => string
}

export interface TextStreamAdapter {
  readonly key: TextStreamAdapterKey
  readonly taskTypes: readonly TaskType[]
  readonly stepIds: readonly string[]
}

function numberKey(value: number | null | undefined, fallbackIndex: number): string {
  return Number.isInteger(value) && value !== null && value !== undefined
    ? String(value)
    : String(fallbackIndex + 1)
}

export const STRUCTURED_STREAM_ADAPTERS: readonly StructuredStreamAdapter[] = [
  {
    key: 'editScript.shots',
    taskTypes: [TASK_TYPE.EDIT_SCRIPT_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE],
    mode: 'array',
    path: ['shots'],
    parseItem: (value) => ({
      kind: 'editScriptShot',
      shot: parseEditScriptStreamShot(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'editScriptShot'
      ? (item.shot.shotId || numberKey(item.shot.shotNumber, fallbackIndex))
      : String(fallbackIndex + 1),
  },
  {
    key: 'shotExecutionPlan.shots',
    taskTypes: [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN],
    mode: 'array',
    path: ['shots'],
    parseItem: (value) => ({
      kind: 'shotExecutionPlanShot',
      shot: editShotExecutionPlanShotSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'shotExecutionPlanShot'
      ? numberKey(item.shot.shotNumber, fallbackIndex)
      : String(fallbackIndex + 1),
  },
  {
    key: 'bgm.scoreDesign.sections',
    taskTypes: [TASK_TYPE.MUSIC_SCORE_PLAN],
    stepIds: ['bgm_score_plan'],
    mode: 'array',
    path: ['scoreDesign', 'sections'],
    parseItem: (value) => ({
      kind: 'bgmDesignSection',
      section: bgmScoreDesignSectionSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'bgmDesignSection'
      ? `${item.section.title}:${fallbackIndex}`
      : String(fallbackIndex + 1),
  },
  {
    key: 'bgm.promptSections',
    taskTypes: [TASK_TYPE.MUSIC_SCORE_PLAN],
    stepIds: ['bgm_score_plan'],
    mode: 'array',
    path: ['promptSections'],
    parseItem: (value) => ({
      kind: 'bgmPromptSection',
      section: bgmScorePromptSectionSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'bgmPromptSection'
      ? `${item.section.title}:${fallbackIndex}`
      : String(fallbackIndex + 1),
  },
  {
    key: 'bgm.virtualLayers',
    taskTypes: [TASK_TYPE.MUSIC_SCORE_PLAN],
    stepIds: ['bgm_score_plan'],
    mode: 'array',
    path: ['virtualLayers'],
    parseItem: (value) => ({
      kind: 'bgmVirtualLayer',
      layer: bgmScoreVirtualLayerSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'bgmVirtualLayer'
      ? `${item.layer.name}:${fallbackIndex}`
      : String(fallbackIndex + 1),
  },
]

export const TEXT_STREAM_ADAPTERS: readonly TextStreamAdapter[] = [
  {
    key: 'editBible.text',
    taskTypes: [TASK_TYPE.EDIT_BIBLE_GENERATE],
    stepIds: [
      AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
      AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET,
      AI_PROMPT_IDS.EDIT_BIBLE_LEDGER,
      AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE,
    ],
  },
]

export function findStructuredStreamAdapters(meta: StructuredStreamTaskEventMeta): readonly StructuredStreamAdapter[] {
  if (!meta.taskType || !meta.stepId) return []
  const taskType = meta.taskType as TaskType
  const stepId = meta.stepId
  return STRUCTURED_STREAM_ADAPTERS.filter((adapter) => (
    adapter.taskTypes.includes(taskType)
    && adapter.stepIds.includes(stepId)
  ))
}

export function findTextStreamAdapters(meta: StructuredStreamTaskEventMeta): readonly TextStreamAdapter[] {
  if (!meta.taskType || !meta.stepId) return []
  const taskType = meta.taskType as TaskType
  const stepId = meta.stepId
  return TEXT_STREAM_ADAPTERS.filter((adapter) => (
    adapter.taskTypes.includes(taskType)
    && adapter.stepIds.includes(stepId)
  ))
}
