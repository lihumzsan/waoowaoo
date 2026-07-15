import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import {
  editBibleSchema,
  rawEditBibleBeatSchema,
  rawEditBibleEmotionalCueSchema,
  rawEditBibleLedgerEventSchema,
  sourceScriptSceneSegmentSchema,
  type EditBible,
  type RawEditBibleBeatSheet,
  type RawEditBibleEmotionalCurve,
  type RawEditBibleLedger,
  type SourceScriptSceneSegment,
} from '@/lib/edit-bible/schemas'
import {
  rawEditShotExecutionPlanShotSchema,
  type RawEditShotExecutionPlanShot,
} from '@/lib/edit-script/types'
import {
  chapterPlanRawShotSchema,
  type ChapterPlanRawShot,
} from '@/lib/edit-chapter/schemas'
import { scoreCueSchema, type ScoreCue } from '@/lib/bgm-design/types'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'


export interface StructuredStreamTaskEventMeta {
  readonly taskType: string | null
  readonly stepId: string | null
}

export type StructuredStreamAdapterKey =
  | 'sourceScript.segments'
  | 'productionPlanning.globalBible'
  | 'productionPlanning.beats'
  | 'productionPlanning.ledgerEvents'
  | 'productionPlanning.emotionalCues'
  | 'editScript.shots'
  | 'shotExecutionPlan.shots'
  | 'bgmDesign.scoreCue'

export type TextStreamAdapterKey =
  | 'disabled.text'

export type StructuredStreamParsedItem =
  | {
    readonly kind: 'sourceScriptSceneSegment'
    readonly segment: SourceScriptSceneSegment
  }
  | {
    readonly kind: 'productionPlanningGlobalBible'
    readonly bible: EditBible
  }
  | {
    readonly kind: 'productionPlanningBeat'
    readonly beat: RawEditBibleBeatSheet['beats'][number]
  }
  | {
    readonly kind: 'productionPlanningLedgerEvent'
    readonly event: RawEditBibleLedger['events'][number]
  }
  | {
    readonly kind: 'productionPlanningEmotionalCue'
    readonly cue: RawEditBibleEmotionalCurve['cues'][number]
  }
  | {
    readonly kind: 'editScriptShot'
    readonly shot: ChapterPlanRawShot
  }
  | {
    readonly kind: 'shotExecutionPlanShot'
    readonly shot: RawEditShotExecutionPlanShot
  }
  | { readonly kind: 'bgmDesignScoreCue'; readonly cue: ScoreCue }

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
    key: 'sourceScript.segments',
    taskTypes: [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT],
    mode: 'array',
    path: ['segments'],
    parseItem: (value) => ({
      kind: 'sourceScriptSceneSegment',
      segment: sourceScriptSceneSegmentSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'sourceScriptSceneSegment'
      ? `${item.segment.episodeIndex}:${item.segment.actIndex}:${item.segment.sceneIndex}`
      : String(fallbackIndex + 1),
  },
  {
    key: 'productionPlanning.globalBible',
    taskTypes: [TASK_TYPE.EDIT_BIBLE_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL],
    mode: 'object',
    path: [],
    parseItem: (value) => ({
      kind: 'productionPlanningGlobalBible',
      bible: editBibleSchema.parse(value),
    }),
    itemKey: () => 'globalBible',
  },
  {
    key: 'productionPlanning.beats',
    taskTypes: [TASK_TYPE.EDIT_BIBLE_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET],
    mode: 'array',
    path: ['beats'],
    parseItem: (value) => ({
      kind: 'productionPlanningBeat',
      beat: rawEditBibleBeatSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'productionPlanningBeat'
      ? item.beat.beatId
      : String(fallbackIndex + 1),
  },
  {
    key: 'productionPlanning.ledgerEvents',
    taskTypes: [TASK_TYPE.EDIT_BIBLE_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_BIBLE_LEDGER],
    mode: 'array',
    path: ['events'],
    parseItem: (value) => ({
      kind: 'productionPlanningLedgerEvent',
      event: rawEditBibleLedgerEventSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'productionPlanningLedgerEvent'
      ? item.event.eventId
      : String(fallbackIndex + 1),
  },
  {
    key: 'productionPlanning.emotionalCues',
    taskTypes: [TASK_TYPE.EDIT_BIBLE_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE],
    mode: 'array',
    path: ['cues'],
    parseItem: (value) => ({
      kind: 'productionPlanningEmotionalCue',
      cue: rawEditBibleEmotionalCueSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'productionPlanningEmotionalCue'
      ? item.cue.cueId
      : String(fallbackIndex + 1),
  },
  {
    key: 'editScript.shots',
    taskTypes: [TASK_TYPE.EDIT_SCRIPT_GENERATE],
    stepIds: [AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE],
    mode: 'array',
    path: ['shots'],
    parseItem: (value) => ({
      kind: 'editScriptShot',
      shot: chapterPlanRawShotSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'editScriptShot'
      ? (item.shot.shotRef || numberKey(item.shot.shotNumber, fallbackIndex))
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
      shot: rawEditShotExecutionPlanShotSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'shotExecutionPlanShot'
      ? item.shot.shotRef
      : String(fallbackIndex + 1),
  },
  {
    key: 'bgmDesign.scoreCue',
    taskTypes: [TASK_TYPE.BGM_DESIGN_PLAN],
    stepIds: ['bgm_design_plan'],
    mode: 'object',
    path: ['scoreCue'],
    parseItem: (value) => ({
      kind: 'bgmDesignScoreCue',
      cue: scoreCueSchema.parse(value),
    }),
    itemKey: (item, fallbackIndex) => item.kind === 'bgmDesignScoreCue'
      ? item.cue.cueId
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
