import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import {
  editShotExecutionPlanSchema,
  editScriptShotSchema,
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
      shot: editScriptShotSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'editScriptShot'
      ? numberKey(item.shot.shotNumber, fallbackIndex)
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

export const TEXT_STREAM_ADAPTERS: readonly TextStreamAdapter[] = []

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
