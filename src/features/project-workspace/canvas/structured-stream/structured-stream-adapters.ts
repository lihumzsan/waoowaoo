import { z } from 'zod'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import {
  editScriptShotSchema,
  editScriptStyleBibleSchema,
  type EditCinematographyShot,
  type EditDirectorDecoupageShot,
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
import { shotBlockingSchema } from '@/lib/edit-script/storyboard-consistency/types'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'

const editCinematographyShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  shotScale: z.string().trim().min(1),
  lens: z.string().trim().min(1),
  depthOfField: z.string().trim().min(1),
  cameraPosition: z.string().trim().min(1),
  cameraHeight: z.string().trim().min(1),
  cameraAngle: z.string().trim().min(1),
  movement: z.string().trim().min(1),
  composition: z.string().trim().min(1),
  lighting: z.string().trim().min(1),
  axisAndEyeline: z.string().trim().min(1),
  continuityIn: z.string().trim().min(1),
  continuityOut: z.string().trim().min(1),
})

const storyboardPanelFinalPromptSchema = z.object({
  panelIndex: z.number().int().min(0),
  sourceShotNumber: z.number().int().positive(),
  sourceVideoBlockId: z.string().trim().min(1),
  shotBlocking: shotBlockingSchema,
  finalPanelPrompt: z.string().trim().min(30),
  finalVideoPrompt: z.string().trim().min(30),
}).strict()

const styleBibleSectionSchema = editScriptStyleBibleSchema.shape.styleBible

export interface StructuredStreamTaskEventMeta {
  readonly taskType: string | null
  readonly stepId: string | null
}

export type StructuredStreamAdapterKey =
  | 'editScript.shots'
  | 'directorDecoupage.shots'
  | 'cinematography.shots'
  | 'storyboard.panels'
  | 'bgm.scoreDesign.sections'
  | 'bgm.promptSections'
  | 'bgm.virtualLayers'
  | 'styleBible.sections'

export type StructuredStreamParsedItem =
  | {
    readonly kind: 'editScriptShot'
    readonly shot: EditScriptShot
  }
  | {
    readonly kind: 'directorDecoupageShot'
    readonly shot: EditDirectorDecoupageShot
  }
  | {
    readonly kind: 'cinematographyShot'
    readonly shot: EditCinematographyShot
  }
  | {
    readonly kind: 'storyboardPanel'
    readonly panel: z.infer<typeof storyboardPanelFinalPromptSchema>
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
  | {
    readonly kind: 'styleBibleSection'
    readonly section: z.infer<typeof styleBibleSectionSchema>
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

function numberKey(value: number | null | undefined, fallbackIndex: number): string {
  return Number.isInteger(value) && value !== null && value !== undefined
    ? String(value)
    : String(fallbackIndex + 1)
}

export const STRUCTURED_STREAM_ADAPTERS: readonly StructuredStreamAdapter[] = [
  {
    key: 'editScript.shots',
    taskTypes: [TASK_TYPE.EDIT_SCRIPT_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY],
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
    key: 'directorDecoupage.shots',
    taskTypes: [TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_DIRECTOR_DECOUPAGE],
    mode: 'array',
    path: ['shots'],
    parseItem: (value) => ({
      kind: 'directorDecoupageShot',
      shot: editScriptShotSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'directorDecoupageShot'
      ? numberKey(item.shot.shotNumber, fallbackIndex)
      : String(fallbackIndex + 1),
  },
  {
    key: 'cinematography.shots',
    taskTypes: [TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_CINEMATOGRAPHY_SHOT_PLAN],
    mode: 'array',
    path: ['shots'],
    parseItem: (value) => ({
      kind: 'cinematographyShot',
      shot: editCinematographyShotSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'cinematographyShot'
      ? numberKey(item.shot.shotNumber, fallbackIndex)
      : String(fallbackIndex + 1),
  },
  {
    key: 'storyboard.panels',
    taskTypes: [TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK],
    mode: 'array',
    path: ['panelFinalPromptBlockOutput', 'panels'],
    parseItem: (value) => ({
      kind: 'storyboardPanel',
      panel: storyboardPanelFinalPromptSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'storyboardPanel'
      ? numberKey(item.panel.panelIndex, fallbackIndex)
      : String(fallbackIndex + 1),
  },
  {
    key: 'bgm.scoreDesign.sections',
    taskTypes: [TASK_TYPE.BGM_SCORE_GENERATE],
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
    taskTypes: [TASK_TYPE.BGM_SCORE_GENERATE],
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
    taskTypes: [TASK_TYPE.BGM_SCORE_GENERATE],
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
  {
    key: 'styleBible.sections',
    taskTypes: [TASK_TYPE.EDIT_SCRIPT_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE],
    mode: 'object',
    path: ['styleBible'],
    parseItem: (value) => ({
      kind: 'styleBibleSection',
      section: styleBibleSectionSchema.parse(value),
    }),
    itemKey: (_item, fallbackIndex) => String(fallbackIndex + 1),
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
