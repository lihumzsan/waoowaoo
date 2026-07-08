import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { readEpisodeEditBible, readEpisodeEditChapters } from '@/lib/edit-bible'
import { generateProjectEditScriptAssets } from '@/lib/edit-script/service'
import { reviseProjectEditScriptAssets } from '@/lib/edit-script/asset-revision'
import {
  submitProjectEditScriptGenerationTask,
  submitProjectEditShotExecutionPlanTask,
  submitProjectEditStylePreviewsGenerationTask,
} from '@/lib/edit-script/task-submission'
import { assertChapterReplanHasNoRunningVideoGroups } from '@/lib/edit-script/replan-guard'
import { submitEditScriptStoryboardPanels } from '@/lib/edit-script/storyboard-consistency/service'
import type { EditScriptPayload } from '@/lib/edit-script/types'
import { editScriptAssetRequirementIdSchema } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import type { TaskBatchSubmittedPartData, TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import {
  buildEditFirstAssistantChoiceCard,
} from '@/lib/project-agent/choice-card'
import {
  buildScriptIntakeChoiceCard,
  planScriptIntakeQuestions,
} from '@/lib/project-agent/script-intake'
import type {
  EditFirstChoiceType,
} from '@/lib/project-agent/edit-first-choice-tools'
import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
} from '@/lib/project-agent/edit-first-choice-tools'
import { createProjectAgentChoiceInterruption } from '@/lib/project-agent/interruptions'
import { resolveEditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'
import {
  EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_PLAN_CHAPTERS_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_REQUIRED_CHAPTER_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_REVISE_ASSETS_CHAPTER_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_SCRIPT_INTAKE_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_STYLE_PREVIEWS_TOOL_INPUT_SCHEMA,
} from '@/lib/project-workflow/edit-first-tool-input-schema'
import { buildEditFirstTextTaskPayload } from '@/lib/edit-script/task-billing'
import { createTaskBatchKey, readLatestFailedTaskBatchKeyForTarget } from '@/lib/task/batch'
import { compensateSubmittedTasks } from '@/lib/operations/planning'

const editScriptVideoRatioSchema = z.enum(['9:16', '16:9', '21:9'])
function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

const confirmedInputFields = {
  confirmed: z.boolean().optional(),
  episodeId: z.string().trim().min(1).optional(),
  chapterId: z.string().trim().min(1).optional(),
} as const

const generateEditStylePreviewsInputSchema = z.object({
  ...confirmedInputFields,
  bibleId: z.string().trim().min(1).optional(),
  styleDirection: z.string().trim().min(1).max(2000).optional().describe('Optional user-requested direction for generating or regenerating the visual style candidates, such as darker, more abstract, more graphic, or a specific non-real-person art direction.'),
  count: z.number().int().min(1).max(3).optional().describe('Number of visual style candidates to generate. Defaults to 3 when omitted. Maximum is 3.'),
}).passthrough()

const requestEditChoiceInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
}).passthrough()

const requestScriptIntakeChoiceInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  seedText: z.string().trim().min(1).max(2000),
}).passthrough()

const generateEditScriptInputSchema = z.object({
  ...confirmedInputFields,
  prompt: z.never().optional(),
  videoRatio: editScriptVideoRatioSchema.optional(),
}).passthrough()

const replanChapterInputSchema = z.object({
  confirmed: z.boolean().optional(),
  episodeId: z.string().trim().min(1).optional(),
  chapterId: z.string().trim().min(1),
  videoRatio: editScriptVideoRatioSchema.optional(),
}).passthrough()

const planChaptersInputSchema = z.object({
  ...confirmedInputFields,
  chapterIds: z.array(z.string().trim().min(1)).min(1).nullable().optional(),
  videoRatio: editScriptVideoRatioSchema.optional(),
}).passthrough()

const generateEditScriptAssetsInputSchema = z.object({
  ...confirmedInputFields,
  editScriptId: z.string().trim().min(1).optional(),
  requirementId: editScriptAssetRequirementIdSchema
    .describe('Optional exact requirement id from editScript.requirements[].id. Omit requirementId to process every requirement. Never pass "*" or any wildcard.')
    .optional(),
}).passthrough()

const reviseEditScriptAssetsInputSchema = z.object({
  ...confirmedInputFields,
  editScriptId: z.string().trim().min(1).optional(),
  requirementId: editScriptAssetRequirementIdSchema
    .describe('Optional exact requirement id from editScript.requirements[].id. Omit requirementId to revise every required asset. Never pass "*" or any wildcard.')
    .optional(),
  revisionNotes: z.string().trim().min(1).describe('Concrete user asset review notes to apply when revising required character/location assets.'),
}).passthrough()

const generateEditShotExecutionPlanInputSchema = z.object({
  ...confirmedInputFields,
  editScriptId: z.string().trim().min(1).optional(),
}).passthrough()

const generateEditScriptStoryboardInputSchema = z.object({
  ...confirmedInputFields,
  editScriptId: z.string().trim().min(1).optional(),
}).passthrough()

type GenerateEditStylePreviewsInput = z.infer<typeof generateEditStylePreviewsInputSchema>
type RequestEditChoiceInput = z.infer<typeof requestEditChoiceInputSchema>
type RequestScriptIntakeChoiceInput = z.infer<typeof requestScriptIntakeChoiceInputSchema>
type GenerateEditScriptInput = z.infer<typeof generateEditScriptInputSchema>
type ReplanChapterInput = z.infer<typeof replanChapterInputSchema>
type PlanChaptersInput = z.infer<typeof planChaptersInputSchema>
type GenerateEditScriptAssetsInput = z.infer<typeof generateEditScriptAssetsInputSchema>
type ReviseEditScriptAssetsInput = z.infer<typeof reviseEditScriptAssetsInputSchema>
type GenerateEditShotExecutionPlanInput = z.infer<typeof generateEditShotExecutionPlanInputSchema>
type GenerateEditScriptStoryboardInput = z.infer<typeof generateEditScriptStoryboardInputSchema>

const requestEditFirstChoiceOutputSchema = z.object({
  emitted: z.literal(true),
  choiceType: z.enum(['script_intake', 'bible_review', 'style', 'asset_review', 'budget_confirmation']),
  cardId: z.string().min(1),
  workflowStage: z.string().min(1),
}).passthrough()

const editStylePreviewsTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    episodeId: z.string().min(1),
    bibleId: z.string().min(1),
    taskType: z.literal(TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE),
    targetType: z.literal('ProjectEditBible'),
    targetId: z.string().min(1),
  }).passthrough(),
)

const editScriptSummaryOutputSchema = z.object({
  id: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  episodeId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
  bibleId: z.string().min(1).optional(),
  sourceDocumentId: z.string().min(1).optional(),
  durationSec: z.number().int().positive(),
  shotCount: z.number().int().min(0),
  status: z.string().optional(),
  assetReviewStatus: z.enum(['pending', 'approved']).optional(),
  requirements: z.array(z.object({
    id: z.string().min(1).optional(),
    kind: z.enum(['character', 'location']),
    name: z.string().min(1),
    status: z.string().optional(),
    targetId: z.string().nullable().optional(),
  }).passthrough()),
  generationSegments: z.array(z.object({
    shotIds: z.array(z.string().min(1)),
    continuity: z.string().min(1),
  }).passthrough()),
}).passthrough()

type EditScriptSummaryOutput = z.infer<typeof editScriptSummaryOutputSchema>

const editScriptAssetGenerationOutputSchema = z.object({
  success: z.literal(true),
  async: z.boolean(),
  total: z.number().int().min(0),
  taskIds: z.array(z.string().min(1)),
  results: z.array(z.object({
    refId: z.string().min(1),
    taskId: z.string().min(1),
    taskType: z.enum([TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION]),
    targetType: z.enum(['CharacterAppearance', 'LocationImage']),
    targetId: z.string().min(1),
  })),
  submittedTasks: z.array(z.object({
    requirementId: z.string().min(1),
    kind: z.enum(['character', 'location']),
    name: z.string().min(1),
    taskId: z.string().min(1),
    status: z.string().min(1),
    runId: z.string().nullable(),
    deduped: z.boolean(),
    taskType: z.enum([TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION]),
    targetType: z.enum(['CharacterAppearance', 'LocationImage']),
    targetId: z.string().min(1),
  })),
  editScript: editScriptSummaryOutputSchema,
}).passthrough()

const editScriptAssetRevisionOutputSchema = z.object({
  success: z.literal(true),
  async: z.boolean(),
  total: z.number().int().min(0),
  revisionNotes: z.string().min(1),
  taskIds: z.array(z.string().min(1)),
  results: z.array(z.object({
    refId: z.string().min(1),
    taskId: z.string().min(1),
    taskType: z.literal(TASK_TYPE.MODIFY_ASSET_IMAGE),
    targetType: z.enum(['CharacterAppearance', 'LocationImage']),
    targetId: z.string().min(1),
  })),
  submittedTasks: z.array(z.object({
    requirementId: z.string().min(1),
    kind: z.enum(['character', 'location']),
    name: z.string().min(1),
    taskId: z.string().min(1),
    status: z.string().min(1),
    runId: z.string().nullable(),
    deduped: z.boolean(),
    taskType: z.literal(TASK_TYPE.MODIFY_ASSET_IMAGE),
    targetType: z.enum(['CharacterAppearance', 'LocationImage']),
    targetId: z.string().min(1),
  })),
  editScript: editScriptSummaryOutputSchema,
}).passthrough()

const planChaptersOutputSchema = z.object({
  success: z.literal(true),
  async: z.literal(true),
  episodeId: z.string().min(1),
  batchKey: z.string().min(1),
  total: z.number().int().min(1),
  taskIds: z.array(z.string().min(1)),
  results: z.array(z.object({
    refId: z.string().min(1),
    taskId: z.string().min(1),
    taskType: z.literal(TASK_TYPE.EDIT_SCRIPT_GENERATE),
    targetType: z.literal('ProjectEditChapter'),
    targetId: z.string().min(1),
  })),
}).passthrough()

const EFFECTS_SYNC_AI_WRITE = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: true,
  bulk: false,
  externalSideEffects: true,
  longRunning: true,
} as const

const EFFECTS_NONE = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_BULK_WRITE = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: true,
  bulk: true,
  externalSideEffects: true,
  longRunning: true,
} as const

function resolveEpisodeId(input: { readonly episodeId?: string }, contextEpisodeId: unknown): string {
  const inputEpisodeId = input.episodeId?.trim() ?? ''
  const scopedEpisodeId = typeof contextEpisodeId === 'string' ? contextEpisodeId.trim() : ''
  const episodeId = inputEpisodeId || scopedEpisodeId
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  return episodeId
}

function resolveLocale(value: unknown): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh'
}

function summarizeEditScriptPayload(payload: EditScriptPayload): EditScriptSummaryOutput {
  return {
    ...(payload.id ? { id: payload.id } : {}),
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
    ...(payload.episodeId ? { episodeId: payload.episodeId } : {}),
    ...(payload.chapterId ? { chapterId: payload.chapterId } : {}),
    ...(payload.bibleId ? { bibleId: payload.bibleId } : {}),
    ...(payload.sourceDocumentId ? { sourceDocumentId: payload.sourceDocumentId } : {}),
    durationSec: payload.durationSec,
    shotCount: payload.shotCount,
    ...(payload.status ? { status: payload.status } : {}),
    assetReviewStatus: payload.assetReviewStatus,
    requirements: payload.requirements.map((requirement) => ({
      ...(requirement.id ? { id: requirement.id } : {}),
      kind: requirement.kind,
      name: requirement.name,
      ...(requirement.status ? { status: requirement.status } : {}),
      ...(requirement.targetId !== undefined ? { targetId: requirement.targetId } : {}),
    })),
    generationSegments: payload.generationSegments.map((segment) => ({
      shotIds: [...segment.shotIds],
      continuity: segment.continuity,
    })),
  }
}

async function resolvePlanChaptersTargets(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterIds?: readonly string[]
}): Promise<readonly { readonly id: string; readonly chapterIndex: number }[]> {
  const [editBible, chapters, editScripts] = await Promise.all([
    readEpisodeEditBible({ projectId: input.projectId, episodeId: input.episodeId }),
    readEpisodeEditChapters({ projectId: input.projectId, episodeId: input.episodeId }),
    prisma.projectEditScript.findMany({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      select: {
        chapterId: true,
        status: true,
      },
    }),
  ])
  if (!editBible) throw new Error(`EDIT_BIBLE_REQUIRED:${input.episodeId}`)
  if (editBible.status !== 'confirmed') {
    throw new Error(`EDIT_BIBLE_NOT_CONFIRMED:${editBible.status}`)
  }
  if (!editBible.styleBible) {
    throw new Error(`EDIT_BIBLE_STYLE_BIBLE_REQUIRED:${editBible.id}`)
  }
  const readyScriptChapterIds = new Set(editScripts
    .filter((script) => script.status === 'ready' || script.status === 'completed')
    .map((script) => script.chapterId)
    .filter((chapterId): chapterId is string => Boolean(chapterId)))
  const selectedIds = input.chapterIds ? new Set(input.chapterIds) : null
  const targets = chapters
    .filter((chapter) => !selectedIds || selectedIds.has(chapter.id))
    .filter((chapter) => selectedIds || !readyScriptChapterIds.has(chapter.id))
    .map((chapter) => ({ id: chapter.id, chapterIndex: chapter.chapterIndex }))
  if (selectedIds && targets.length !== selectedIds.size) {
    const foundIds = new Set(chapters.map((chapter) => chapter.id))
    const missingIds = Array.from(selectedIds).filter((chapterId) => !foundIds.has(chapterId))
    if (missingIds.length > 0) {
      throw new Error(`EDIT_CHAPTERS_NOT_FOUND:${missingIds.join(',')}`)
    }
  }
  if (targets.length === 0) {
    throw new Error(`EDIT_CHAPTERS_ALREADY_PLANNED:${input.episodeId}`)
  }
  return targets
}

const REQUEST_EDIT_CHOICE_SUMMARIES: Record<EditFirstChoiceType, string> = {
  script_intake: 'Request one structured creative intake choice before script expansion when the user prompt is too sparse. Pass only the exact user seed text.',
  bible_review: 'Request episode plan confirmation after the global planning baseline is ready. This tool has a fixed choice type; do not pass a choiceType argument.',
  style: 'Request visual style selection after style previews are ready. This tool has a fixed choice type; do not pass a choiceType argument.',
  asset_review: 'Request required asset review after assets and spatial profiles are ready. This tool has a fixed choice type; do not pass a choiceType argument.',
  budget_confirmation: 'Request explicit user budget confirmation before the assistant starts the current billable or batch production stage. This tool has a fixed choice type; do not pass a choiceType argument.',
}

function buildRequestEditChoiceOperation(choiceType: EditFirstChoiceType) {
  const operationId = EDIT_FIRST_CHOICE_TOOL_IDS[choiceType]
  const isScriptIntake = choiceType === 'script_intake'
  return defineOperation({
    id: operationId,
    summary: REQUEST_EDIT_CHOICE_SUMMARIES[choiceType],
    intent: 'query',
    prerequisites: { episodeId: 'required' },
    effects: EFFECTS_NONE,
    agentFlow: {
      interruptsFor: 'choice',
    },
    toolInputSchema: isScriptIntake ? EDIT_FIRST_SCRIPT_INTAKE_TOOL_INPUT_SCHEMA : EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
    inputSchema: isScriptIntake ? requestScriptIntakeChoiceInputSchema : requestEditChoiceInputSchema,
    outputSchema: requestEditFirstChoiceOutputSchema,
    execute: async (ctx, input: RequestEditChoiceInput | RequestScriptIntakeChoiceInput) => {
      const toolCallId = ctx.toolCallId?.trim() || ''
      if (!toolCallId) {
        throw new Error('REQUEST_EDIT_CHOICE_TOOL_CALL_ID_REQUIRED')
      }
      const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
      const workflow = await resolveEditFirstWorkflowState({
        projectId: ctx.projectId,
        userId: ctx.userId,
        episodeId,
      })
      const locale = resolveLocale(ctx.context.locale)
      const runId = ctx.context.runId?.trim()
      if (!runId) {
        throw new Error('REQUEST_EDIT_CHOICE_RUN_ID_REQUIRED')
      }
      const card = isScriptIntake
        ? buildScriptIntakeChoiceCard({
            locale,
            workflow,
            toolCallId,
            seedText: (input as RequestScriptIntakeChoiceInput).seedText,
            plan: await planScriptIntakeQuestions({
              userId: ctx.userId,
              projectId: ctx.projectId,
              locale,
              seedText: (input as RequestScriptIntakeChoiceInput).seedText,
            }),
          })
        : await buildEditFirstAssistantChoiceCard({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
            locale,
            workflow,
            choiceType,
            toolCallId,
          })
      const interruptionId = await createProjectAgentChoiceInterruption({
        runId,
        projectId: ctx.projectId,
        userId: ctx.userId,
        episodeId,
        assistantId: 'workspace-command',
        operationId,
        toolCallId,
        previousActivityId: ctx.context.currentActivityId ?? null,
        payload: toInputJsonValue({
          choiceType,
          cardId: card.cardId,
          card: {
            ...card,
            runId,
          },
        }),
      })
      writeOperationDataPart<ProjectAgentChoiceCardPartData>(ctx.writer, 'data-assistant-choice-card', {
        ...card,
        runId,
        interruptionId,
      })
      return requestEditFirstChoiceOutputSchema.parse({
        emitted: true,
        choiceType,
        cardId: card.cardId,
        workflowStage: workflow.stage,
      })
    },
  })
}

export function createEditScriptOperations(): ProjectAgentOperationRegistryDraft {
  const editScriptTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
      chapterId: z.string().min(1),
      taskType: z.literal(TASK_TYPE.EDIT_SCRIPT_GENERATE),
      targetType: z.literal('ProjectEditChapter'),
      targetId: z.string().min(1),
    }).passthrough(),
  )
  const editShotExecutionPlanTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
      editScriptId: z.string().min(1),
      taskType: z.literal(TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE),
      targetType: z.literal('ProjectEditScript'),
      targetId: z.string().min(1),
    }).passthrough(),
  )
  const editScriptStoryboardTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
      editScriptId: z.string().min(1),
      taskType: z.literal(TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN),
      targetType: z.literal('ProjectEditScript'),
      targetId: z.string().min(1),
    }).passthrough(),
  )

  return {
    generate_edit_style_previews: defineOperation({
      id: 'generate_edit_style_previews',
      summary: 'Generate Bible-based visual style preview image tasks after the episode Bible has been confirmed. During visual style choice, use it again only when the user asks to regenerate or adjust candidates; styleDirection carries that user feedback when present.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: false,
      },
      agentFlow: {
        onTaskComplete: 'await_user_choice',
      },
      toolInputSchema: EDIT_FIRST_STYLE_PREVIEWS_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditStylePreviewsInputSchema,
      outputSchema: editStylePreviewsTaskSubmitOutputSchema,
      execute: async (ctx, input: GenerateEditStylePreviewsInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await submitProjectEditStylePreviewsGenerationTask({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          locale: resolveLocale(ctx.context.locale),
          source: ctx.source,
          confirmed: input.confirmed === true,
          ...(input.bibleId ? { bibleId: input.bibleId } : {}),
          ...(input.styleDirection ? { styleDirection: input.styleDirection } : {}),
          ...(input.count ? { count: input.count } : {}),
        })
        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_edit_style_previews',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId: result.episodeId,
          taskType: TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE,
          targetType: 'ProjectEditBible',
          targetId: result.bibleId,
        })
        return editStylePreviewsTaskSubmitOutputSchema.parse(result)
      },
    }),
    [EDIT_FIRST_CHOICE_TOOL_IDS.script_intake]: buildRequestEditChoiceOperation('script_intake'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.bible_review]: buildRequestEditChoiceOperation('bible_review'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.style]: buildRequestEditChoiceOperation('style'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.asset_review]: buildRequestEditChoiceOperation('asset_review'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.budget_confirmation]: buildRequestEditChoiceOperation('budget_confirmation'),
    generate_edit_script: defineOperation({
      id: 'generate_edit_script',
      summary: 'Build the core edit plan for one chapter from the confirmed episode Bible, selected Style Bible, and chapter source slice.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将基于已确认剧集规划、风格和当前章节源文本生成并覆盖本章核心剪辑计划（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditScriptInputSchema,
      outputSchema: editScriptTaskSubmitOutputSchema,
      execute: async (ctx, input: GenerateEditScriptInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const chapterId = input.chapterId?.trim()
        const result = await submitProjectEditScriptGenerationTask({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          ...(chapterId ? { chapterId } : {}),
          ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
          source: ctx.source,
          confirmed: input.confirmed === true,
          locale: resolveLocale(ctx.context.locale),
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_edit_script',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId: result.episodeId,
          chapterId: result.chapterId,
          taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
          targetType: 'ProjectEditChapter',
          targetId: result.chapterId,
        })

        return result
      },
    }),
    replan_chapter: defineOperation({
      id: 'replan_chapter',
      summary: 'Regenerate the core edit plan for one explicit chapter from the confirmed episode Bible, selected Style Bible, and chapter source slice.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将重新生成并覆盖指定章节的核心剪辑计划（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_REQUIRED_CHAPTER_TOOL_INPUT_SCHEMA,
      inputSchema: replanChapterInputSchema,
      outputSchema: editScriptTaskSubmitOutputSchema,
      execute: async (ctx, input: ReplanChapterInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        await assertChapterReplanHasNoRunningVideoGroups({
          projectId: ctx.projectId,
          episodeId,
          chapterId: input.chapterId,
        })
        const batchKey = await readLatestFailedTaskBatchKeyForTarget({
          projectId: ctx.projectId,
          episodeId,
          type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
          targetType: 'ProjectEditChapter',
          targetId: input.chapterId,
        })
        const result = await submitProjectEditScriptGenerationTask({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          chapterId: input.chapterId,
          ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
          source: ctx.source,
          confirmed: input.confirmed === true,
          locale: resolveLocale(ctx.context.locale),
          batchKey,
          operationId: 'replan_chapter',
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'replan_chapter',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId: result.episodeId,
          chapterId: result.chapterId,
          taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
          targetType: 'ProjectEditChapter',
          targetId: result.chapterId,
        })

        return result
      },
    }),
    plan_chapters: defineOperation({
      id: 'plan_chapters',
      summary: 'Submit chapter core edit planning tasks for every selected chapter from the confirmed episode Bible and Style Bible.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: true,
        summary: '将为本集所有选中章节批量提交核心剪辑计划任务（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_PLAN_CHAPTERS_TOOL_INPUT_SCHEMA,
      inputSchema: planChaptersInputSchema,
      outputSchema: planChaptersOutputSchema,
      execute: async (ctx, input: PlanChaptersInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const chapters = await resolvePlanChaptersTargets({
          projectId: ctx.projectId,
          episodeId,
          ...(input.chapterIds ? { chapterIds: input.chapterIds } : {}),
        })
        const batchKey = createTaskBatchKey('plan_chapters')
        const submitted: Array<{
          readonly chapterId: string
          readonly taskId: string
        }> = []
        try {
          for (const chapter of chapters) {
            const payload = await buildEditFirstTextTaskPayload({
              projectId: ctx.projectId,
              userId: ctx.userId,
              payload: {
                episodeId,
                chapterId: chapter.id,
                ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
              },
            })
            const result = await submitOperationTask({
              request: ctx.request,
              projectId: ctx.projectId,
              userId: ctx.userId,
              episodeId,
              type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
              targetType: 'ProjectEditChapter',
              targetId: chapter.id,
              operationId: 'plan_chapters',
              source: ctx.source,
              confirmed: input.confirmed === true,
              payload,
              dedupeKey: `edit_script_generate:${ctx.projectId}:${episodeId}:${chapter.id}`,
              batchKey,
              locale: resolveLocale(ctx.context.locale),
            })
            submitted.push({
              chapterId: chapter.id,
              taskId: result.taskId,
            })
          }
        } catch (error) {
          await compensateSubmittedTasks(submitted.map((item) => item.taskId))
          throw error
        }

        const output = planChaptersOutputSchema.parse({
          success: true,
          async: true,
          episodeId,
          batchKey,
          total: submitted.length,
          taskIds: submitted.map((item) => item.taskId),
          results: submitted.map((item) => ({
            refId: item.chapterId,
            taskId: item.taskId,
            taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
            targetType: 'ProjectEditChapter',
            targetId: item.chapterId,
          })),
        })
        writeOperationDataPart<TaskBatchSubmittedPartData>(ctx.writer, 'data-task-batch-submitted', {
          operationId: 'plan_chapters',
          total: output.total,
          taskTotal: output.total,
          targetTotal: output.total,
          taskIds: output.taskIds,
          results: output.results,
        })
        return output
      },
    }),
    generate_edit_script_assets: defineOperation({
      id: 'generate_edit_script_assets',
      summary: 'Create or reuse required character/location assets from the current core edit plan and submit missing image generation tasks.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: true,
        summary: '将根据核心剪辑计划创建/复用角色与场景资产，并为缺失图片提交生成任务（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditScriptAssetsInputSchema,
      outputSchema: editScriptAssetGenerationOutputSchema,
      execute: async (ctx, input: GenerateEditScriptAssetsInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await generateProjectEditScriptAssets({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          chapterId: input.chapterId,
          locale: resolveLocale(ctx.context.locale),
          ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
          ...(input.requirementId ? { requirementId: input.requirementId } : {}),
        })
        const output = editScriptAssetGenerationOutputSchema.parse({
          success: result.success,
          async: result.async,
          total: result.total,
          taskIds: [...result.taskIds],
          results: result.results.map((item) => ({ ...item })),
          submittedTasks: result.submittedTasks.map((item) => ({ ...item })),
          editScript: summarizeEditScriptPayload(result.editScript),
        })
        if (output.taskIds.length > 0) {
          writeOperationDataPart<TaskBatchSubmittedPartData>(ctx.writer, 'data-task-batch-submitted', {
            operationId: 'generate_edit_script_assets',
            total: output.total,
            taskIds: output.taskIds,
            results: output.results,
          })
        }
        return output
      },
    }),
    revise_edit_script_assets: defineOperation({
      id: 'revise_edit_script_assets',
      summary: 'Revise ready required character/location asset images from user asset review notes and submit async modification tasks.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: true,
        summary: '将根据用户审核意见返工所需资产图片，并提交图片修改任务（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_REVISE_ASSETS_CHAPTER_TOOL_INPUT_SCHEMA,
      inputSchema: reviseEditScriptAssetsInputSchema,
      outputSchema: editScriptAssetRevisionOutputSchema,
      execute: async (ctx, input: ReviseEditScriptAssetsInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await reviseProjectEditScriptAssets({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          chapterId: input.chapterId,
          locale: resolveLocale(ctx.context.locale),
          revisionNotes: input.revisionNotes,
          ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
          ...(input.requirementId ? { requirementId: input.requirementId } : {}),
        })
        const output = editScriptAssetRevisionOutputSchema.parse({
          success: result.success,
          async: result.async,
          total: result.total,
          revisionNotes: result.revisionNotes,
          taskIds: [...result.taskIds],
          results: result.results.map((item) => ({ ...item })),
          submittedTasks: result.submittedTasks.map((item) => ({ ...item })),
          editScript: summarizeEditScriptPayload(result.editScript),
        })
        if (output.taskIds.length > 0) {
          writeOperationDataPart<TaskBatchSubmittedPartData>(ctx.writer, 'data-task-batch-submitted', {
            operationId: 'revise_edit_script_assets',
            total: output.total,
            taskIds: output.taskIds,
            results: output.results,
          })
        }
        return output
      },
    }),
    generate_edit_shot_execution_plan: defineOperation({
      id: 'generate_edit_shot_execution_plan',
      summary: 'Generate the full shot execution plan from the ready core edit plan, completed assets, spatial profiles, and Style Bible.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将基于核心剪辑计划、资产和空间档案生成并覆盖本集镜头执行计划（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditShotExecutionPlanInputSchema,
      outputSchema: editShotExecutionPlanTaskSubmitOutputSchema,
      execute: async (ctx, input: GenerateEditShotExecutionPlanInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await submitProjectEditShotExecutionPlanTask({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          chapterId: input.chapterId,
          source: ctx.source,
          confirmed: input.confirmed === true,
          locale: resolveLocale(ctx.context.locale),
          ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_edit_shot_execution_plan',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId: result.episodeId,
          taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
          targetType: 'ProjectEditScript',
          targetId: result.editScriptId,
        })

        return editShotExecutionPlanTaskSubmitOutputSchema.parse(result)
      },
    }),
    generate_edit_script_storyboard: defineOperation({
      id: 'generate_edit_script_storyboard',
      summary: 'Generate storyboard panels from the ready core edit plan, shot execution plan, required assets, spatial profiles, and Style Bible.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: true,
        summary: '将根据已完成的空间档案、核心剪辑计划、镜头执行计划和资产生成正式分镜面板提示词（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditScriptStoryboardInputSchema,
      outputSchema: editScriptStoryboardTaskSubmitOutputSchema,
      execute: async (ctx, input: GenerateEditScriptStoryboardInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await submitEditScriptStoryboardPanels({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          chapterId: input.chapterId,
          locale: resolveLocale(ctx.context.locale),
          ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
          requestId: ctx.request.headers.get('x-request-id'),
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_edit_script_storyboard',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId,
          taskType: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
          targetType: 'ProjectEditScript',
          targetId: result.editScriptId,
        })

        return {
          ...result,
          episodeId,
          taskType: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
          targetType: 'ProjectEditScript' as const,
          targetId: result.editScriptId,
        }
      },
    }),
  }
}
