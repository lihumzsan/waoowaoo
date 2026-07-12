import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { readEpisodeEditBible, readEpisodeEditChapters } from '@/lib/edit-bible'
import { commitProjectEditScriptAssetRevisions, planProjectEditScriptAssetRevisions } from '@/lib/edit-script/asset-revision'
import { approveProjectEpisodeEditScriptAssets, confirmProjectEditStylePreview } from '@/lib/edit-script/service'
import {
  submitProjectEditShotExecutionPlanBatchTasks,
  submitProjectEditScriptGenerationTask,
  submitProjectEditShotExecutionPlanTask,
} from '@/lib/edit-script/task-submission'
import { assertChapterReplanHasNoRunningVideoGroups } from '@/lib/edit-script/replan-guard'
import { submitEditScriptStoryboardPanels } from '@/lib/edit-script/storyboard-consistency/service'
import type { EditScriptPayload } from '@/lib/edit-script/types'
import { editScriptAssetRequirementIdSchema } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import type { TaskBatchSubmittedPartData, TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  submitOperationTask,
  submitOperationTaskBatch,
} from '@/lib/operations/submit-operation-task'
import { buildEditFirstAssistantChoiceOfferCandidate } from '@/lib/project-agent/choice-card'
import { buildScriptIntakeChoiceOfferCandidate, planScriptIntakeQuestions } from '@/lib/project-agent/script-intake'
import type { EditFirstChoiceType } from '@/lib/project-agent/edit-first-choice-tools'
import { EDIT_FIRST_CHOICE_TYPES, EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
import { prepareProjectAgentChoiceExecutionHandoff } from '@/lib/project-agent/execution-handoff'
import { resolveEditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import {
  EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_CONFIRM_STYLE_PREVIEW_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_PLAN_CHAPTERS_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_REQUIRED_CHAPTER_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_REVISE_ASSETS_CHAPTER_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_SCRIPT_INTAKE_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_STYLE_PREVIEWS_TOOL_INPUT_SCHEMA,
} from '@/lib/project-workflow/edit-first-tool-input-schema'
import { buildEditFirstTextTaskPayload } from '@/lib/edit-script/task-billing'
import { createTaskBatchKey, readLatestFailedTaskBatchKeyForTarget } from '@/lib/task/batch'
import { submitPlannedOperationTasks, type OperationPlan } from '@/lib/operations/planning'
import { planProjectEditStylePreviews, readEditStylePreviewPlanMetadata } from '@/lib/edit-script/style-preview-operation-plan'
import {
  commitProjectEditScriptAssetsOperation,
  planProjectEditScriptAssetsOperation,
} from '@/lib/edit-script/asset-generation-operation-plan'

const editScriptVideoRatioSchema = z.enum(['9:16', '16:9', '21:9'])
const scopedInputFields = {
  episodeId: z.string().trim().min(1).optional(),
  chapterId: z.string().trim().min(1).optional(),
} as const

const generateEditStylePreviewsInputSchema = z
  .object({
    ...scopedInputFields,
    bibleId: z.string().trim().min(1).optional(),
    styleDirection: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .optional()
      .describe(
        'Optional user-requested direction for generating or regenerating the visual style candidates, such as darker, more abstract, more graphic, or a specific non-real-person art direction.',
      ),
    count: z
      .number()
      .int()
      .min(1)
      .max(3)
      .optional()
      .describe('Number of visual style candidates to generate. Defaults to 3 when omitted. Maximum is 3.'),
  })
  .passthrough()

const confirmEditStylePreviewInputSchema = z
  .object({
    episodeId: z.string().trim().min(1).optional(),
  })
  .strict()

const requestEditChoiceInputSchema = z
  .object({
    episodeId: z.string().trim().min(1).optional(),
  })
  .passthrough()

const requestScriptIntakeChoiceInputSchema = z
  .object({
    episodeId: z.string().trim().min(1).optional(),
    seedText: z.string().trim().min(1).max(2000),
  })
  .passthrough()

const generateEditScriptInputSchema = z
  .object({
    ...scopedInputFields,
    prompt: z.never().optional(),
    videoRatio: editScriptVideoRatioSchema.optional(),
  })
  .passthrough()

const replanChapterInputSchema = z
  .object({
    episodeId: z.string().trim().min(1).optional(),
    chapterId: z.string().trim().min(1),
    videoRatio: editScriptVideoRatioSchema.optional(),
  })
  .passthrough()

const planChaptersInputSchema = z
  .object({
    ...scopedInputFields,
    chapterIds: z.array(z.string().trim().min(1)).min(1).nullable().optional(),
    videoRatio: editScriptVideoRatioSchema.optional(),
  })
  .passthrough()

const generateEditScriptAssetsInputSchema = z
  .object({
    ...scopedInputFields,
    editScriptId: z.string().trim().min(1).optional(),
    requirementId: editScriptAssetRequirementIdSchema
      .describe(
        'Optional exact requirement id from editScript.requirements[].id. Omit requirementId to process every requirement. Never pass "*" or any wildcard.',
      )
      .optional(),
  })
  .passthrough()

const reviseEditScriptAssetsInputSchema = z
  .object({
    ...scopedInputFields,
    editScriptId: z.string().trim().min(1).optional(),
    requirementId: editScriptAssetRequirementIdSchema
      .describe(
        'Optional exact requirement id from editScript.requirements[].id. Omit requirementId to revise every required asset. Never pass "*" or any wildcard.',
      )
      .optional(),
    revisionNotes: z
      .string()
      .trim()
      .min(1)
      .describe('Concrete user asset review notes to apply when revising required character/location assets.'),
  })
  .passthrough()

const generateEditShotExecutionPlanInputSchema = z
  .object({
    ...scopedInputFields,
    editScriptId: z.string().trim().min(1).optional(),
  })
  .passthrough()

const generateEditScriptStoryboardInputSchema = z
  .object({
    ...scopedInputFields,
    editScriptId: z.string().trim().min(1).optional(),
  })
  .passthrough()

type GenerateEditStylePreviewsInput = z.infer<typeof generateEditStylePreviewsInputSchema>
type ConfirmEditStylePreviewInput = z.infer<typeof confirmEditStylePreviewInputSchema>
type RequestEditChoiceInput = z.infer<typeof requestEditChoiceInputSchema>
type RequestScriptIntakeChoiceInput = z.infer<typeof requestScriptIntakeChoiceInputSchema>
type GenerateEditScriptInput = z.infer<typeof generateEditScriptInputSchema>
type ReplanChapterInput = z.infer<typeof replanChapterInputSchema>
type PlanChaptersInput = z.infer<typeof planChaptersInputSchema>
type GenerateEditScriptAssetsInput = z.infer<typeof generateEditScriptAssetsInputSchema>
type ReviseEditScriptAssetsInput = z.infer<typeof reviseEditScriptAssetsInputSchema>
type GenerateEditShotExecutionPlanInput = z.infer<typeof generateEditShotExecutionPlanInputSchema>
type GenerateEditScriptStoryboardInput = z.infer<typeof generateEditScriptStoryboardInputSchema>

async function submitPlannedEditStylePreviewTasks(
  ctx: ProjectAgentOperationContext,
  input: GenerateEditStylePreviewsInput,
  plan: OperationPlan,
) {
  const transaction = ctx.executionAuthorization?.transaction
  if (!transaction) throw new Error('OPERATION_EXECUTION_TRANSACTION_REQUIRED')
  const metadata = readEditStylePreviewPlanMetadata(plan)
  const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
  const results = await submitPlannedOperationTasks({
    ctx,
    operationId: 'generate_edit_style_previews',
  })
  const submitted = plan.tasks.map((task) => {
    const result = results.get(task.id)
    if (!result) throw new Error(`EDIT_STYLE_PREVIEW_TASK_RESULT_MISSING:${task.id}`)
    return { task, result }
  })
  await Promise.all(
    submitted.map(({ task, result }) =>
      transaction.projectEditStylePreview.update({
        where: { id: task.target.targetId },
        data: {
          taskId: result.taskId,
          status: 'generating',
          errorMessage: null,
        },
      }),
    ),
  )
  const first = submitted[0]
  if (!first) throw new Error('EDIT_STYLE_PREVIEW_PLAN_EMPTY')
  return {
    ...first.result,
    episodeId,
    bibleId: metadata.bibleId,
    taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
    targetType: first.task.target.targetType,
    targetId: first.task.target.targetId,
    taskIds: submitted.map(({ result }) => result.taskId),
    total: submitted.length,
  }
}

const requestEditFirstChoiceOutputSchema = z
  .object({
    emitted: z.literal(true),
    choiceType: z.enum(EDIT_FIRST_CHOICE_TYPES),
    cardId: z.string().min(1),
    workflowStage: z.string().min(1),
  })
  .passthrough()

const editStylePreviewsTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase
    .extend({
      episodeId: z.string().min(1),
      bibleId: z.string().min(1),
      taskType: z.literal(TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE),
      targetType: z.literal('ProjectEditStylePreview'),
      targetId: z.string().min(1),
      taskIds: z.array(z.string().min(1)).min(1),
      total: z.number().int().positive(),
    })
    .passthrough(),
)

const confirmEditStylePreviewOutputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    episodeId: z.string().min(1),
    status: z.literal('confirmed'),
    aspectRatio: editScriptVideoRatioSchema,
    targetType: z.literal('ProjectEditStylePreview'),
    targetId: z.string().min(1),
  })
  .passthrough()

const editScriptSummaryOutputSchema = z
  .object({
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
    requirements: z.array(
      z
        .object({
          id: z.string().min(1).optional(),
          kind: z.enum(['character', 'location']),
          name: z.string().min(1),
          status: z.string().optional(),
          targetId: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
    generationSegments: z.array(
      z
        .object({
          shotIds: z.array(z.string().min(1)),
          continuity: z.string().min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough()

type EditScriptSummaryOutput = z.infer<typeof editScriptSummaryOutputSchema>

const editScriptAssetGenerationOutputSchema = z
  .object({
    success: z.literal(true),
    async: z.boolean(),
    noop: z.boolean().optional(),
    total: z.number().int().min(0),
    processedRequirementCount: z.number().int().min(0),
    remainingRequirementCount: z.number().int().min(0),
    taskIds: z.array(z.string().min(1)),
    results: z.array(
      z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        taskType: z.enum([TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION]),
        targetType: z.enum(['CharacterAppearance', 'LocationImage']),
        targetId: z.string().min(1),
      }),
    ),
    submittedTasks: z.array(
      z.object({
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
      }),
    ),
    editScript: editScriptSummaryOutputSchema,
  })
  .passthrough()

function toEditScriptAssetGenerationOutput(result: Awaited<ReturnType<typeof commitProjectEditScriptAssetsOperation>>) {
  return editScriptAssetGenerationOutputSchema.parse({
    success: result.success,
    async: result.async,
    noop: result.taskIds.length === 0 && result.remainingRequirementCount === 0 ? true : undefined,
    total: result.total,
    processedRequirementCount: result.processedRequirementCount,
    remainingRequirementCount: result.remainingRequirementCount,
    taskIds: [...result.taskIds],
    results: result.results.map((item) => ({ ...item })),
    submittedTasks: result.submittedTasks.map((item) => ({ ...item })),
    editScript: summarizeEditScriptPayload(result.editScript),
  })
}

const editScriptAssetRevisionOutputSchema = z
  .object({
    success: z.literal(true),
    async: z.boolean(),
    noop: z.boolean().optional(),
    total: z.number().int().min(0),
    revisionNotes: z.string().min(1),
    taskIds: z.array(z.string().min(1)),
    results: z.array(
      z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        taskType: z.literal(TASK_TYPE.MODIFY_ASSET_IMAGE),
        targetType: z.enum(['CharacterAppearance', 'LocationImage']),
        targetId: z.string().min(1),
      }),
    ),
    submittedTasks: z.array(
      z.object({
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
      }),
    ),
    editScript: editScriptSummaryOutputSchema,
  })
  .passthrough()

const editScriptAssetApprovalOutputSchema = z.object({
  approvedCount: z.number().int().min(1),
  scripts: z.array(z.unknown()).min(1),
})

const planChaptersOutputSchema = z
  .object({
    success: z.literal(true),
    async: z.literal(true),
    episodeId: z.string().min(1),
    batchKey: z.string().min(1),
    total: z.number().int().min(1),
    taskIds: z.array(z.string().min(1)),
    results: z.array(
      z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        taskType: z.literal(TASK_TYPE.EDIT_SCRIPT_GENERATE),
        targetType: z.literal('ProjectEditChapter'),
        targetId: z.string().min(1),
      }),
    ),
  })
  .passthrough()

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

const EFFECTS_DOMAIN_WRITE = {
  writes: true,
  billable: false,
  destructive: false,
  overwrite: true,
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
    readEpisodeEditBible({
      projectId: input.projectId,
      episodeId: input.episodeId,
    }),
    readEpisodeEditChapters({
      projectId: input.projectId,
      episodeId: input.episodeId,
    }),
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
  const readyScriptChapterIds = new Set(
    editScripts
      .filter((script) => script.status === 'ready' || script.status === 'completed')
      .map((script) => script.chapterId)
      .filter((chapterId): chapterId is string => Boolean(chapterId)),
  )
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
  script_intake:
    'Request one structured creative intake choice before script expansion when the user has not provided a complete script and the brief lacks the basic conditions needed for direct expansion. Pass only the exact user seed text.',
  script_review:
    'Request generated script confirmation before generating the global episode plan. This tool has a fixed choice type; do not pass a choiceType argument.',
  bible_review:
    'Request episode plan confirmation after the global planning baseline is ready. This tool has a fixed choice type; do not pass a choiceType argument.',
  style:
    'Request visual style selection after style previews are ready. This tool has a fixed choice type; do not pass a choiceType argument.',
  asset_review:
    'Request required asset review after assets and spatial profiles are ready. This tool has a fixed choice type; do not pass a choiceType argument.',
}

function buildRequestEditChoiceOperation(choiceType: EditFirstChoiceType) {
  const operationId = EDIT_FIRST_CHOICE_TOOL_IDS[choiceType]
  const isScriptIntake = choiceType === 'script_intake'
  return defineOperation({
    id: operationId,
    summary: REQUEST_EDIT_CHOICE_SUMMARIES[choiceType],
    intent: 'query',
    channels: { tool: true, api: false },
    prerequisites: { episodeId: 'required' },
    effects: EFFECTS_NONE,
    agentFlow: {
      suspendsFor: 'choice',
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
      const executionSegmentId = ctx.context.executionSegmentId?.trim()
      if (!executionSegmentId) {
        throw new Error('REQUEST_EDIT_CHOICE_EXECUTION_SEGMENT_REQUIRED')
      }
      if (ctx.executionFence && ctx.executionFence.runFence.runId !== runId) {
        throw new Error(`REQUEST_EDIT_CHOICE_RUN_FENCE_MISMATCH:${runId}`)
      }
      const candidate = isScriptIntake
        ? buildScriptIntakeChoiceOfferCandidate({
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
        : await buildEditFirstAssistantChoiceOfferCandidate({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
            locale,
            workflow,
            choiceType,
            toolCallId,
          })
      const handoff = await prepareProjectAgentChoiceExecutionHandoff({
        executionFence: (() => {
          if (!ctx.executionFence) throw new Error('PROJECT_AGENT_CHOICE_EXECUTION_FENCE_REQUIRED')
          return ctx.executionFence
        })(),
        executionSegmentId,
        projectId: ctx.projectId,
        userId: ctx.userId,
        episodeId,
        locale: ctx.context.locale ?? null,
        assistantId: 'workspace-command',
        operationId,
        toolCallId,
        card: candidate.card,
        reviewedResource: candidate.reviewedResource,
      })
      return requestEditFirstChoiceOutputSchema.parse({
        emitted: true,
        choiceType,
        cardId: handoff.card.cardId,
        workflowStage: workflow.stage,
      })
    },
  })
}

export function createEditScriptOperations(): ProjectAgentOperationRegistryDraft {
  const editScriptTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        episodeId: z.string().min(1),
        chapterId: z.string().min(1),
        taskType: z.literal(TASK_TYPE.EDIT_SCRIPT_GENERATE),
        targetType: z.literal('ProjectEditChapter'),
        targetId: z.string().min(1),
      })
      .passthrough(),
  )
  const editShotExecutionPlanTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        episodeId: z.string().min(1),
        editScriptId: z.string().min(1),
        taskType: z.literal(TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE),
        targetType: z.literal('ProjectEditScript'),
        targetId: z.string().min(1),
      })
      .passthrough(),
  )
  const editShotExecutionPlanBatchTaskSubmitOutputSchema = z
    .object({
      success: z.literal(true),
      async: z.literal(true),
      episodeId: z.string().min(1),
      batchKey: z.string().min(1),
      total: z.number().int().min(1),
      taskIds: z.array(z.string().min(1)),
      results: z.array(
        z.object({
          refId: z.string().min(1),
          taskId: z.string().min(1),
          taskType: z.literal(TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE),
          targetType: z.literal('ProjectEditScript'),
          targetId: z.string().min(1),
        }),
      ),
      submittedTasks: z.array(
        z.object({
          chapterId: z.string().min(1),
          editScriptId: z.string().min(1),
          taskId: z.string().min(1),
          status: z.string().min(1),
          runId: z.string().nullable(),
          deduped: z.boolean(),
          taskType: z.literal(TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE),
          targetType: z.literal('ProjectEditScript'),
          targetId: z.string().min(1),
        }),
      ),
    })
    .passthrough()
  const editShotExecutionPlanOperationOutputSchema = z.union([
    editShotExecutionPlanTaskSubmitOutputSchema,
    editShotExecutionPlanBatchTaskSubmitOutputSchema,
  ])
  const editScriptStoryboardTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        episodeId: z.string().min(1),
        editScriptId: z.string().min(1),
        taskType: z.literal(TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN),
        targetType: z.literal('ProjectEditScript'),
        targetId: z.string().min(1),
      })
      .passthrough(),
  )

  return {
    generate_edit_style_previews: defineOperation({
      id: 'generate_edit_style_previews',
      summary:
        'Generate Bible-based visual style preview image tasks after the episode Bible has been confirmed. During visual style choice, use it again only when the user asks to regenerate or adjust candidates; styleDirection carries that user feedback when present.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将生成视觉风格候选图片并产生媒体费用。批准后执行当前已确定的生成调用。',
      },
      agentFlow: {
        onTaskComplete: 'resume_agent',
      },
      toolInputSchema: EDIT_FIRST_STYLE_PREVIEWS_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditStylePreviewsInputSchema,
      outputSchema: editStylePreviewsTaskSubmitOutputSchema,
      plan: async (ctx, input: GenerateEditStylePreviewsInput) =>
        await planProjectEditStylePreviews({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: resolveEpisodeId(input, ctx.context.episodeId),
          locale: resolveLocale(ctx.context.locale),
          ...(input.bibleId ? { bibleId: input.bibleId } : {}),
          ...(input.styleDirection ? { styleDirection: input.styleDirection } : {}),
          ...(input.count ? { count: input.count } : {}),
        }),
      commit: async (ctx, input: GenerateEditStylePreviewsInput, plan) => {
        const result = await submitPlannedEditStylePreviewTasks(ctx, input, plan)
        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_edit_style_previews',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId: result.episodeId,
          taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
          targetType: 'ProjectEditStylePreview',
          targetId: result.targetId,
        })
        return editStylePreviewsTaskSubmitOutputSchema.parse(result)
      },
    }),
    confirm_edit_style_preview: defineOperation({
      id: 'confirm_edit_style_preview',
      summary:
        'Persist the exact visual style candidate selected by the user in the consumed style Choice. This is the only operation allowed to write the selected style.',
      intent: 'act',
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_DOMAIN_WRITE,
      confirmation: {
        kind: 'none',
        required: false,
      },
      toolInputSchema: EDIT_FIRST_CONFIRM_STYLE_PREVIEW_TOOL_INPUT_SCHEMA,
      inputSchema: confirmEditStylePreviewInputSchema,
      outputSchema: confirmEditStylePreviewOutputSchema,
      executeInTransaction: async (ctx, input: ConfirmEditStylePreviewInput, transaction) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const choiceDecision = ctx.context.choiceDecision
        if (choiceDecision?.choiceType !== 'style' || choiceDecision.decision !== 'select') {
          throw new Error('EDIT_STYLE_PREVIEW_CHOICE_DECISION_REQUIRED')
        }
        const project = await transaction.project.findFirst({
          where: { id: ctx.projectId, userId: ctx.userId },
          select: { videoRatio: true },
        })
        const aspectRatio = editScriptVideoRatioSchema.safeParse(project?.videoRatio)
        if (!aspectRatio.success) {
          throw new Error('EDIT_STYLE_PREVIEW_PROJECT_VIDEO_RATIO_REQUIRED')
        }
        const confirmed = await confirmProjectEditStylePreview({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          stylePreviewId: choiceDecision.stylePreviewId,
          aspectRatio: aspectRatio.data,
          client: transaction,
        })
        return confirmEditStylePreviewOutputSchema.parse({
          ...confirmed,
          targetType: 'ProjectEditStylePreview',
          targetId: confirmed.id,
        })
      },
    }),
    [EDIT_FIRST_CHOICE_TOOL_IDS.script_intake]: buildRequestEditChoiceOperation('script_intake'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.script_review]: buildRequestEditChoiceOperation('script_review'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.bible_review]: buildRequestEditChoiceOperation('bible_review'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.style]: buildRequestEditChoiceOperation('style'),
    [EDIT_FIRST_CHOICE_TOOL_IDS.asset_review]: buildRequestEditChoiceOperation('asset_review'),
    generate_edit_script: defineOperation({
      id: 'generate_edit_script',
      summary: 'Build the core edit plan for one chapter from the confirmed episode Bible, selected Style Bible, and chapter source slice.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
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
      summary:
        'Regenerate the core edit plan for one explicit chapter from the confirmed episode Bible, selected Style Bible, and chapter source slice.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
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
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
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
        const submissions = await Promise.all(chapters.map(async (chapter) => {
          const payload = await buildEditFirstTextTaskPayload({
              projectId: ctx.projectId,
              userId: ctx.userId,
              payload: {
                episodeId,
                chapterId: chapter.id,
                ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
              },
            })
          return {
              request: ctx.request,
              projectId: ctx.projectId,
              userId: ctx.userId,
              episodeId,
              type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
              targetType: 'ProjectEditChapter',
              targetId: chapter.id,
              operationId: 'plan_chapters',
              source: ctx.source,
              payload,
              dedupeKey: `edit_script_generate:${ctx.projectId}:${episodeId}:${chapter.id}`,
              batchKey,
              locale: resolveLocale(ctx.context.locale),
            }
        }))
        const submittedResults = await submitOperationTaskBatch(submissions)
        const submitted = chapters.map((chapter, index) => {
          const result = submittedResults[index]
          if (!result) throw new Error(`PLAN_CHAPTERS_TASK_RESULT_MISSING:${chapter.id}`)
          return { chapterId: chapter.id, taskId: result.taskId }
        })

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
      summary:
        'Create or reuse required character/location assets from the current core edit plan and submit missing image generation tasks.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将根据核心剪辑计划创建/复用角色与场景资产，并为缺失图片提交收费生成任务；用户批准当前不可变计划后执行。',
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditScriptAssetsInputSchema,
      outputSchema: editScriptAssetGenerationOutputSchema,
      plan: async (ctx, input: GenerateEditScriptAssetsInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        return await planProjectEditScriptAssetsOperation(ctx, {
          episodeId,
          ...(input.chapterId ? { chapterId: input.chapterId } : {}),
          ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
          ...(input.requirementId ? { requirementId: input.requirementId } : {}),
        })
      },
      commit: async (ctx, input: GenerateEditScriptAssetsInput, plan) => {
        return toEditScriptAssetGenerationOutput(
          await commitProjectEditScriptAssetsOperation({
            ctx,
            input,
            plan,
          }),
        )
      },
    }),
    approve_edit_script_assets: defineOperation({
      id: 'approve_edit_script_assets',
      summary: 'Record the user approval of all ready required edit-first assets so shot execution planning can proceed.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        kind: 'none',
        required: false,
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: requestEditChoiceInputSchema,
      outputSchema: editScriptAssetApprovalOutputSchema,
      executeInTransaction: async (ctx, input, transaction) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        return editScriptAssetApprovalOutputSchema.parse(
          await approveProjectEpisodeEditScriptAssets({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
            client: transaction,
          }),
        )
      },
    }),
    revise_edit_script_assets: defineOperation({
      id: 'revise_edit_script_assets',
      summary: 'Revise ready required character/location asset images from user asset review notes and submit async modification tasks.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将根据用户审核意见返工所需资产图片并产生媒体费用；用户批准当前不可变计划后执行。',
      },
      toolInputSchema: EDIT_FIRST_REVISE_ASSETS_CHAPTER_TOOL_INPUT_SCHEMA,
      inputSchema: reviseEditScriptAssetsInputSchema,
      outputSchema: editScriptAssetRevisionOutputSchema,
      plan: async (ctx, input: ReviseEditScriptAssetsInput) =>
        await planProjectEditScriptAssetRevisions({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: resolveEpisodeId(input, ctx.context.episodeId),
          chapterId: input.chapterId,
          locale: resolveLocale(ctx.context.locale),
          revisionNotes: input.revisionNotes,
          ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
          ...(input.requirementId ? { requirementId: input.requirementId } : {}),
        }),
      commit: async (ctx, _input: ReviseEditScriptAssetsInput, plan) => {
        const result = await commitProjectEditScriptAssetRevisions({
          ctx,
          plan,
        })
        const output = editScriptAssetRevisionOutputSchema.parse({
          success: result.success,
          async: result.async,
          noop: result.taskIds.length === 0 ? true : undefined,
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
      effects: EFFECTS_BULK_WRITE,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: generateEditShotExecutionPlanInputSchema,
      outputSchema: editShotExecutionPlanOperationOutputSchema,
      execute: async (ctx, input: GenerateEditShotExecutionPlanInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        if (ctx.source === 'assistant-panel' || (!input.chapterId && !input.editScriptId)) {
          const batchKey = createTaskBatchKey('edit_shot_execution_plan_generate')
          const result = await submitProjectEditShotExecutionPlanBatchTasks({
            request: ctx.request,
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
            batchKey,
            source: ctx.source,
            locale: resolveLocale(ctx.context.locale),
          })
          writeOperationDataPart<TaskBatchSubmittedPartData>(ctx.writer, 'data-task-batch-submitted', {
            operationId: 'generate_edit_shot_execution_plan',
            total: result.total,
            taskTotal: result.total,
            targetTotal: result.total,
            taskIds: result.taskIds,
            results: result.results,
          })
          return editShotExecutionPlanOperationOutputSchema.parse(result)
        }

        const result = await submitProjectEditShotExecutionPlanTask({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          chapterId: input.chapterId,
          source: ctx.source,
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

        return editShotExecutionPlanOperationOutputSchema.parse(result)
      },
    }),
    generate_edit_script_storyboard: defineOperation({
      id: 'generate_edit_script_storyboard',
      summary:
        'Generate storyboard panels from the ready core edit plan, shot execution plan, required assets, spatial profiles, and Style Bible.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
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
          request: ctx.request,
          source: ctx.source,
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
