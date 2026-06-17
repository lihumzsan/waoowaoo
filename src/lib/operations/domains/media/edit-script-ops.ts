import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  generateProjectEditCinematographyShotPlan,
  generateProjectEditDirectorDecoupage,
  generateProjectEditScreenplay,
  generateProjectEditScriptAssets,
  generateProjectEditStylePreviews,
  reviseProjectEditScreenplay,
} from '@/lib/edit-script/service'
import { submitEditScriptStoryboardPanels } from '@/lib/edit-script/storyboard-consistency/service'
import type { EditCinematographyShotPlanPayload, EditDirectorDecoupagePayload, EditScriptPayload } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import type { EditStylePreviewGenerationPartData, TaskBatchSubmittedPartData, TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import {
  buildEditFirstAssistantChoiceCard,
} from '@/lib/project-agent/choice-card'
import type {
  EditFirstChoiceType,
} from '@/lib/project-agent/choice-card'
import { createProjectAgentChoiceInterruption } from '@/lib/project-agent/interruptions'
import { resolveEditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import {
  refineTaskBatchSubmitOperationOutputSchema,
  refineTaskSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'
import {
  EDIT_FIRST_DURATION_TIERS,
} from '@/lib/edit-script/duration-tier'

const editScriptVideoRatioSchema = z.enum(['9:16', '16:9', '21:9'])
const editFirstDurationTierSchema = z.enum(EDIT_FIRST_DURATION_TIERS)

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

const confirmedInputFields = {
  confirmed: z.boolean().optional(),
  episodeId: z.string().trim().min(1).optional(),
} as const

const generateEditScreenplayInputSchema = z.object({
  ...confirmedInputFields,
  prompt: z.string().trim().min(1).describe('The user creative request/story premise. Do not use this field as the only carrier for duration or aspect ratio.'),
  durationTier: editFirstDurationTierSchema.describe('Required edit-first duration tier. Use the value selected by the user in request_edit_first_choice: short, medium, or long.'),
  aspectRatio: editScriptVideoRatioSchema.describe('Required final film aspect ratio. Use the value selected by the user in request_edit_first_choice.'),
}).passthrough()

const reviseEditScreenplayInputSchema = z.object({
  ...confirmedInputFields,
  screenplayId: z.string().trim().min(1).optional(),
  revisionInstruction: z.string().trim().min(1).describe('Concrete user-requested screenplay changes to apply to the current generated edit-first screenplay.'),
  durationTier: editFirstDurationTierSchema.describe('Required edit-first duration tier. Use the original duration tier selected by the user unless the user explicitly changes it.'),
  aspectRatio: editScriptVideoRatioSchema.describe('Required final film aspect ratio. Use the original aspect ratio selected by the user unless the user explicitly changes it.'),
}).passthrough()

const generateEditStylePreviewsInputSchema = z.object({
  ...confirmedInputFields,
  screenplayId: z.string().trim().min(1).optional(),
  styleDirection: z.string().trim().min(1).max(2000).optional().describe('Optional user-requested direction for generating or regenerating the visual style candidates, such as darker, more abstract, more graphic, or a specific non-real-person art direction.'),
  count: z.number().int().min(1).max(3).optional().describe('Number of visual style candidates to generate. Defaults to 3 when omitted. Maximum is 3.'),
  replaceExisting: z.literal(true).optional().describe('When regenerating existing visual style candidates, pass true or omit this field. Appending candidates is not supported.'),
}).passthrough()

const requestEditFirstChoiceInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  choiceType: z.enum(['duration_and_aspect_ratio', 'screenplay_review', 'style']),
}).passthrough()

const generateEditScriptInputSchema = z.object({
  ...confirmedInputFields,
  prompt: z.never().optional(),
  screenplayId: z.string().trim().min(1).optional(),
  videoRatio: editScriptVideoRatioSchema.optional(),
}).passthrough()

const generateEditDirectorDecoupageInputSchema = z.object({
  ...confirmedInputFields,
  screenplayId: z.string().trim().min(1).optional(),
}).passthrough()

const generateEditScriptAssetsInputSchema = z.object({
  ...confirmedInputFields,
  editScriptId: z.string().trim().min(1).optional(),
  requirementId: z.string().trim().min(1).optional(),
}).passthrough()

const generateEditCinematographyShotPlanInputSchema = z.object({
  ...confirmedInputFields,
  editScriptId: z.string().trim().min(1).optional(),
}).passthrough()

const generateEditScriptStoryboardInputSchema = z.object({
  ...confirmedInputFields,
  editScriptId: z.string().trim().min(1).optional(),
}).passthrough()

type GenerateEditScreenplayInput = z.infer<typeof generateEditScreenplayInputSchema>
type ReviseEditScreenplayInput = z.infer<typeof reviseEditScreenplayInputSchema>
type GenerateEditStylePreviewsInput = z.infer<typeof generateEditStylePreviewsInputSchema>
type RequestEditFirstChoiceInput = z.infer<typeof requestEditFirstChoiceInputSchema>
type GenerateEditDirectorDecoupageInput = z.infer<typeof generateEditDirectorDecoupageInputSchema>
type GenerateEditScriptInput = z.infer<typeof generateEditScriptInputSchema>
type GenerateEditScriptAssetsInput = z.infer<typeof generateEditScriptAssetsInputSchema>
type GenerateEditCinematographyShotPlanInput = z.infer<typeof generateEditCinematographyShotPlanInputSchema>
type GenerateEditScriptStoryboardInput = z.infer<typeof generateEditScriptStoryboardInputSchema>

const editScreenplayOutputSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  userPrompt: z.string(),
  screenplayText: z.string().min(1),
  status: z.string().min(1),
}).passthrough()

const requestEditFirstChoiceOutputSchema = z.object({
  emitted: z.literal(true),
  choiceType: z.enum(['duration_and_aspect_ratio', 'screenplay_review', 'style']),
  cardId: z.string().min(1),
  workflowStage: z.string().min(1),
}).passthrough()

const editStylePreviewGenerationOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
  taskBatchSubmitOperationOutputSchemaBase.extend({
    projectId: z.string().min(1),
    episodeId: z.string().min(1),
    screenplayId: z.string().min(1),
    status: z.literal('queued'),
    stylePreviews: z.array(z.object({
      id: z.string().min(1),
      styleKey: z.enum(['style_a', 'style_b', 'style_c']),
      aspectRatio: editScriptVideoRatioSchema.optional(),
      title: z.string().min(1),
      summary: z.string().min(1),
      status: z.string().min(1),
      taskId: z.string().min(1),
    })),
  }).passthrough(),
)

type EditStylePreviewGenerationOutput = z.infer<typeof editStylePreviewGenerationOutputSchema>

const editScriptSummaryOutputSchema = z.object({
  id: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  episodeId: z.string().min(1).optional(),
  title: z.string().min(1),
  logline: z.string().nullable().optional(),
  durationSec: z.number().int().positive(),
  shotCount: z.number().int().min(0),
  status: z.string().optional(),
  requirements: z.array(z.object({
    id: z.string().min(1).optional(),
    kind: z.enum(['character', 'location']),
    name: z.string().min(1),
    status: z.string().optional(),
    targetId: z.string().nullable().optional(),
  }).passthrough()),
  videoBlocks: z.array(z.object({
    kind: z.enum(['single', 'group']),
    shotNumbers: z.array(z.number().int().positive()),
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

const editDirectorDecoupageOutputSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  screenplayId: z.string().min(1),
  status: z.string().min(1),
  shotCount: z.number().int().positive(),
}).passthrough()

const editCinematographyShotPlanOutputSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  editScriptId: z.string().min(1),
  status: z.string().min(1),
  shotCount: z.number().int().positive(),
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
    title: payload.title,
    ...(payload.logline !== undefined ? { logline: payload.logline } : {}),
    durationSec: payload.durationSec,
    shotCount: payload.shotCount,
    ...(payload.status ? { status: payload.status } : {}),
    requirements: payload.requirements.map((requirement) => ({
      ...(requirement.id ? { id: requirement.id } : {}),
      kind: requirement.kind,
      name: requirement.name,
      ...(requirement.status ? { status: requirement.status } : {}),
      ...(requirement.targetId !== undefined ? { targetId: requirement.targetId } : {}),
    })),
    videoBlocks: payload.videoBlocks.map((block) => ({
      kind: block.kind,
      shotNumbers: [...block.shotNumbers],
    })),
  }
}

function summarizeDirectorDecoupagePayload(payload: EditDirectorDecoupagePayload) {
  return {
    id: payload.id,
    projectId: payload.projectId,
    episodeId: payload.episodeId,
    screenplayId: payload.screenplayId,
    status: payload.status,
    shotCount: payload.shots.length,
  }
}

function summarizeCinematographyShotPlanPayload(payload: EditCinematographyShotPlanPayload) {
  return {
    id: payload.id,
    projectId: payload.projectId,
    episodeId: payload.episodeId,
    editScriptId: payload.editScriptId,
    status: payload.status,
    shotCount: payload.shots.length,
  }
}

export function createEditScriptOperations(): ProjectAgentOperationRegistryDraft {
  const editScriptTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
    }).passthrough(),
  )

  return {
    generate_edit_screenplay: defineOperation({
      id: 'generate_edit_screenplay',
      summary: 'Generate the editable screenplay artifact for edit-first production. Required input fields: prompt, durationTier, and aspectRatio. durationTier and aspectRatio must come from the user selection made through request_edit_first_choice; do not rely on prompt text alone. Stops at screenplay review; style preview images are generated by generate_edit_style_previews after user approval.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将调用文本模型生成并覆盖本集剪辑先行剧本（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEditScreenplayInputSchema,
      outputSchema: editScreenplayOutputSchema,
      execute: async (ctx, input: GenerateEditScreenplayInput) => {
        return editScreenplayOutputSchema.parse(await generateProjectEditScreenplay({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: resolveEpisodeId(input, ctx.context.episodeId),
          locale: resolveLocale(ctx.context.locale),
          prompt: input.prompt,
          durationTier: input.durationTier,
          aspectRatio: input.aspectRatio,
        }))
      },
    }),
    revise_edit_screenplay: defineOperation({
      id: 'revise_edit_screenplay',
      summary: 'Revise the current generated edit-first screenplay during screenplay review only. Required input fields: revisionInstruction, durationTier, and aspectRatio. Use when the user asks to change the story, tone, structure, theme, ending, or atmosphere before approving the screenplay. Stops at screenplay review; do not generate style previews or later edit artifacts.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将根据用户修改要求重新生成并覆盖当前剪辑先行剧本（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: reviseEditScreenplayInputSchema,
      outputSchema: editScreenplayOutputSchema,
      execute: async (ctx, input: ReviseEditScreenplayInput) => {
        return editScreenplayOutputSchema.parse(await reviseProjectEditScreenplay({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: resolveEpisodeId(input, ctx.context.episodeId),
          locale: resolveLocale(ctx.context.locale),
          ...(input.screenplayId ? { screenplayId: input.screenplayId } : {}),
          revisionInstruction: input.revisionInstruction,
          durationTier: input.durationTier,
          aspectRatio: input.aspectRatio,
        }))
      },
    }),
    generate_edit_style_previews: defineOperation({
      id: 'generate_edit_style_previews',
      summary: 'Generate or regenerate screenplay-based visual style preview image tasks after the user has reviewed and approved the screenplay. Use it again during visual style choice when the user asks to regenerate or adjust the candidates. Optional styleDirection carries the user feedback, count is 1-3 and defaults to 3, and regeneration replaces the existing candidate set.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: true,
        summary: '将基于已审核剧本生成 3 个视觉风格候选图（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      agentFlow: {
        onTaskComplete: 'await_user_choice',
      },
      inputSchema: generateEditStylePreviewsInputSchema,
      outputSchema: editStylePreviewGenerationOutputSchema,
      execute: async (ctx, input: GenerateEditStylePreviewsInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = editStylePreviewGenerationOutputSchema.parse(await generateProjectEditStylePreviews({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          locale: resolveLocale(ctx.context.locale),
          ...(input.screenplayId ? { screenplayId: input.screenplayId } : {}),
          ...(input.styleDirection ? { styleDirection: input.styleDirection } : {}),
          ...(input.count ? { count: input.count } : {}),
          ...(input.replaceExisting !== undefined ? { replaceExisting: input.replaceExisting } : {}),
        }))
        writeOperationDataPart<EditStylePreviewGenerationPartData>(ctx.writer, 'data-edit-style-preview-generation', {
          operationId: 'generate_edit_style_previews',
          agentRunId: ctx.context.runId ?? null,
          projectId: result.projectId,
          episodeId: result.episodeId,
          screenplayId: result.screenplayId,
          items: result.stylePreviews.map((preview: EditStylePreviewGenerationOutput['stylePreviews'][number]) => ({
            id: preview.id,
            styleKey: preview.styleKey,
            title: preview.title,
            summary: preview.summary,
            taskId: preview.taskId,
            ...(preview.aspectRatio ? { aspectRatio: preview.aspectRatio } : {}),
          })),
        })
        return result
      },
    }),
    request_edit_first_choice: defineOperation({
      id: 'request_edit_first_choice',
      summary: 'Request a fixed assistant choice card for edit-first production content choices only. Use duration_and_aspect_ratio before screenplay generation, screenplay_review after screenplay generation, and style after screenplay-based style previews are ready. Do not use this tool for execution permission; call the target operation directly and let runtime approval handle confirmation.',
      intent: 'query',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_NONE,
      inputSchema: requestEditFirstChoiceInputSchema,
      outputSchema: requestEditFirstChoiceOutputSchema,
      execute: async (ctx, input: RequestEditFirstChoiceInput) => {
        const toolCallId = ctx.toolCallId?.trim() || ''
        if (!toolCallId) {
          throw new Error('REQUEST_EDIT_FIRST_CHOICE_TOOL_CALL_ID_REQUIRED')
        }
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const workflow = await resolveEditFirstWorkflowState({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
        })
        const choiceType: EditFirstChoiceType = input.choiceType
        const locale = resolveLocale(ctx.context.locale)
        const runId = ctx.context.runId?.trim()
        if (!runId) {
          throw new Error('REQUEST_EDIT_FIRST_CHOICE_RUN_ID_REQUIRED')
        }
        const card = await buildEditFirstAssistantChoiceCard({
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
          operationId: 'request_edit_first_choice',
          toolCallId,
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
    }),
    generate_edit_director_decoupage: defineOperation({
      id: 'generate_edit_director_decoupage',
      summary: 'Generate the full-shot director decoupage from a ready edit screenplay and Style Bible before building the executable edit table.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将基于 ready 剧本生成并覆盖本集导演拆镜（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEditDirectorDecoupageInputSchema,
      outputSchema: editDirectorDecoupageOutputSchema,
      execute: async (ctx, input: GenerateEditDirectorDecoupageInput) => editDirectorDecoupageOutputSchema.parse(summarizeDirectorDecoupagePayload(
        await generateProjectEditDirectorDecoupage({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: resolveEpisodeId(input, ctx.context.episodeId),
          locale: resolveLocale(ctx.context.locale),
          ...(input.screenplayId ? { screenplayId: input.screenplayId } : {}),
        }),
      )),
    }),
    generate_edit_script: defineOperation({
      id: 'generate_edit_script',
      summary: 'Build the executable edit-first core table from ready director decoupage. Fails if no ready screenplay or director decoupage exists.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将基于已存在剧本生成并覆盖本集剪辑先行表（可能消耗额度/产生计费）。没有 ready 剧本时会失败。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEditScriptInputSchema,
      outputSchema: editScriptTaskSubmitOutputSchema,
      execute: async (ctx, input: GenerateEditScriptInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const payload: Record<string, unknown> = {
          episodeId,
          ...(input.screenplayId ? { screenplayId: input.screenplayId } : {}),
          ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
        }
        const result = await submitOperationTask({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
          targetType: 'ProjectEpisode',
          targetId: episodeId,
          operationId: 'generate_edit_script',
          source: ctx.source,
          confirmed: input.confirmed === true,
          payload,
          dedupeKey: `edit_script_generate:${ctx.projectId}:${episodeId}`,
          billingInfo: null,
          locale: resolveLocale(ctx.context.locale),
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_edit_script',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId,
          taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
          targetType: 'ProjectEpisode',
          targetId: episodeId,
        })

        return {
          ...result,
          episodeId,
        }
      },
    }),
    generate_edit_script_assets: defineOperation({
      id: 'generate_edit_script_assets',
      summary: 'Create or reuse required character/location assets from the current edit-first table and submit missing image generation tasks.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: true,
        summary: '将根据剪辑先行表创建/复用角色与场景资产，并为缺失图片提交生成任务（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEditScriptAssetsInputSchema,
      outputSchema: editScriptAssetGenerationOutputSchema,
      execute: async (ctx, input: GenerateEditScriptAssetsInput) => {
        const result = await generateProjectEditScriptAssets({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: resolveEpisodeId(input, ctx.context.episodeId),
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
    generate_edit_cinematography_shot_plan: defineOperation({
      id: 'generate_edit_cinematography_shot_plan',
      summary: 'Generate the full-shot cinematography plan from the ready edit table, director decoupage, completed assets, and spatial profiles.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SYNC_AI_WRITE,
      confirmation: {
        required: true,
        summary: '将基于剪辑表、导演拆镜、资产和空间档案生成并覆盖本集摄影 shot plan（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEditCinematographyShotPlanInputSchema,
      outputSchema: editCinematographyShotPlanOutputSchema,
      execute: async (ctx, input: GenerateEditCinematographyShotPlanInput) => editCinematographyShotPlanOutputSchema.parse(summarizeCinematographyShotPlanPayload(
        await generateProjectEditCinematographyShotPlan({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: resolveEpisodeId(input, ctx.context.episodeId),
          locale: resolveLocale(ctx.context.locale),
          ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
        }),
      )),
    }),
    generate_edit_script_storyboard: defineOperation({
      id: 'generate_edit_script_storyboard',
      summary: 'Generate storyboard panels from ready director decoupage, cinematography shot plan, spatial profiles, edit table, and required assets.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BULK_WRITE,
      confirmation: {
        required: true,
        summary: '将根据已完成的空间档案、剪辑先行表和资产生成正式分镜面板提示词（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEditScriptStoryboardInputSchema,
      outputSchema: editScriptTaskSubmitOutputSchema,
      execute: async (ctx, input: GenerateEditScriptStoryboardInput) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await submitEditScriptStoryboardPanels({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
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
          targetType: 'ProjectStoryboard',
          targetId: result.storyboardId,
        })

        return {
          ...result,
          episodeId,
          taskType: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
          targetType: 'ProjectStoryboard',
          targetId: result.storyboardId,
        }
      },
    }),
  }
}
