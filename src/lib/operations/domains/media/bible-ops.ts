import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  confirmEpisodeEditBible,
  confirmEditBibleInputSchema,
  getEditBibleInputSchema,
  getEditChaptersInputSchema,
  ingestEditBibleScriptInputSchema,
  readEpisodeEditBible,
  readEpisodeEditChapters,
  reviseEditBibleInputSchema,
  reviseEpisodeEditBible,
  submitProjectEditBibleGenerationTask,
} from '@/lib/edit-bible'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import type { ProjectAgentToolInputSchema } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import { TASK_TYPE } from '@/lib/task/types'
import {
  EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_INGEST_SCRIPT_TOOL_INPUT_SCHEMA,
  EDIT_FIRST_REVISE_BIBLE_TOOL_INPUT_SCHEMA,
} from '@/lib/project-workflow/edit-first-tool-input-schema'

const optionalEpisodeIdField = {
  episodeId: z.string().trim().min(1).optional(),
} as const

const chapterDetailOperationInputSchema = z.object({
  ...optionalEpisodeIdField,
  chapterId: z.string().trim().min(1),
}).passthrough()
const ingestScriptOperationInputSchema = ingestEditBibleScriptInputSchema.extend(optionalEpisodeIdField)
const reviseBibleOperationInputSchema = reviseEditBibleInputSchema.extend({
  ...optionalEpisodeIdField,
  confirmed: z.boolean().optional(),
})
const confirmBibleOperationInputSchema = confirmEditBibleInputSchema.extend({
  ...optionalEpisodeIdField,
  confirmed: z.boolean().optional(),
})

const editBibleTaskSubmitOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    episodeId: z.string().min(1),
    sourceDocumentId: z.string().min(1),
    editBibleId: z.string().min(1),
    taskType: z.literal(TASK_TYPE.EDIT_BIBLE_GENERATE),
    targetType: z.literal('ProjectEditBible'),
    targetId: z.string().min(1),
  }).passthrough(),
)

const editBibleReadOutputSchema = z.object({
  editBible: z.unknown().nullable(),
  chapters: z.array(z.unknown()),
}).passthrough()

const episodeOverviewOutputSchema = editBibleReadOutputSchema.extend({
  chapterSummary: z.object({
    total: z.number().int().min(0),
    planned: z.number().int().min(0),
    rendered: z.number().int().min(0),
    failedRender: z.number().int().min(0),
  }),
}).passthrough()

const chapterDetailOutputSchema = z.object({
  chapter: z.unknown(),
}).passthrough()

const editBibleMutationOutputSchema = z.object({
  editBible: z.unknown(),
  chapters: z.array(z.unknown()).optional(),
}).passthrough()

const GET_CHAPTER_DETAIL_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = {
  type: 'object',
  properties: {
    chapterId: {
      type: 'string',
      minLength: 1,
      description: 'Exact chapterId to inspect. Do not pass projectId or episodeId.',
    },
  },
  required: ['chapterId'],
  additionalProperties: false,
}

const EFFECTS_QUERY = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_BIBLE_GENERATE = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: true,
  bulk: true,
  externalSideEffects: true,
  longRunning: true,
} as const

const EFFECTS_BIBLE_WRITE = {
  writes: true,
  billable: false,
  destructive: false,
  overwrite: true,
  bulk: true,
  externalSideEffects: false,
  longRunning: false,
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

function summarizeChapters(chapters: ReadonlyArray<{
  readonly status?: string | null
  readonly renderStatus?: string | null
}>): {
  readonly total: number
  readonly planned: number
  readonly rendered: number
  readonly failedRender: number
} {
  return {
    total: chapters.length,
    planned: chapters.filter((chapter) => chapter.status === 'ready').length,
    rendered: chapters.filter((chapter) => chapter.renderStatus === 'completed').length,
    failedRender: chapters.filter((chapter) => chapter.renderStatus === 'failed').length,
  }
}

async function readChapterDetail(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
}) {
  const chapter = await prisma.projectEditChapter.findFirst({
    where: {
      id: input.chapterId,
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
    },
    select: {
      id: true,
      chapterIndex: true,
      title: true,
      summary: true,
      sourceStart: true,
      sourceEnd: true,
      targetDurationSec: true,
      status: true,
      renderStatus: true,
      renderTaskId: true,
      outputMediaId: true,
      outputMedia: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          durationMs: true,
          width: true,
          height: true,
        },
      },
      editScript: {
        select: {
          id: true,
          status: true,
          durationSec: true,
          shotCount: true,
          assetReviewStatus: true,
          updatedAt: true,
        },
      },
      shotExecutionPlan: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
        },
      },
      requirements: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          name: true,
          status: true,
          targetId: true,
          errorMessage: true,
        },
      },
      storyboards: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          editScriptId: true,
          panelCount: true,
          lastError: true,
          updatedAt: true,
          _count: { select: { panels: true } },
        },
      },
      videoGroups: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          shotIds: true,
          durationSec: true,
          videoUrl: true,
          videoMediaId: true,
          errorCode: true,
          errorMessage: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!chapter) throw new Error(`PROJECT_AGENT_CHAPTER_NOT_FOUND:${input.chapterId}`)
  return chapter
}

export function createBibleOperations(): ProjectAgentOperationRegistryDraft {
  return {
    ingest_script: defineOperation({
      id: 'ingest_script',
      summary: 'Upload or paste an episode source script, create an immutable SourceDocument, and submit the async long-form edit bible generation task.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BIBLE_GENERATE,
      confirmation: {
        required: true,
        summary: '将上传/保存本集源剧本，并调用文本模型生成长视频 Bible、台账、情绪曲线和章节切分（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_INGEST_SCRIPT_TOOL_INPUT_SCHEMA,
      inputSchema: ingestScriptOperationInputSchema,
      outputSchema: editBibleTaskSubmitOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await submitProjectEditBibleGenerationTask({
          request: ctx.request,
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          sourceKind: input.sourceKind,
          text: input.text,
          ...(input.rawFileMediaId ? { rawFileMediaId: input.rawFileMediaId } : {}),
          source: ctx.source,
          confirmed: input.confirmed === true,
          locale: resolveLocale(ctx.context.locale),
        })
        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'ingest_script',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId,
          taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
          targetType: 'ProjectEditBible',
          targetId: result.editBibleId,
        })
        return editBibleTaskSubmitOutputSchema.parse(result)
      },
    }),
    get_edit_bible: defineOperation({
      id: 'get_edit_bible',
      summary: 'Read the current episode edit bible and planned chapters.',
      intent: 'query',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_QUERY,
      inputSchema: getEditBibleInputSchema,
      outputSchema: editBibleReadOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const [editBible, chapters] = await Promise.all([
          readEpisodeEditBible({ projectId: ctx.projectId, episodeId }),
          readEpisodeEditChapters({ projectId: ctx.projectId, episodeId }),
        ])
        return editBibleReadOutputSchema.parse({ editBible, chapters })
      },
    }),
    list_edit_chapters: defineOperation({
      id: 'list_edit_chapters',
      summary: 'List planned chapters for the current episode after edit bible generation.',
      intent: 'query',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_QUERY,
      inputSchema: getEditChaptersInputSchema,
      outputSchema: z.object({ chapters: z.array(z.unknown()) }).passthrough(),
      execute: async (ctx, input) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const chapters = await readEpisodeEditChapters({ projectId: ctx.projectId, episodeId })
        return { chapters: [...chapters] }
      },
    }),
    get_episode_overview: defineOperation({
      id: 'get_episode_overview',
      summary: 'Read the scoped episode overview: edit bible, chapter plan list, and lightweight chapter progress counts.',
      intent: 'query',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_QUERY,
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: getEditBibleInputSchema,
      outputSchema: episodeOverviewOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const [editBible, chapters] = await Promise.all([
          readEpisodeEditBible({ projectId: ctx.projectId, episodeId }),
          readEpisodeEditChapters({ projectId: ctx.projectId, episodeId }),
        ])
        return episodeOverviewOutputSchema.parse({
          editBible,
          chapters,
          chapterSummary: summarizeChapters(chapters),
        })
      },
    }),
    get_chapter_detail: defineOperation({
      id: 'get_chapter_detail',
      summary: 'Read lightweight details for one chapter, including plan metadata, storyboard status, video group status, asset requirements, and chapter render output.',
      intent: 'query',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_QUERY,
      toolInputSchema: GET_CHAPTER_DETAIL_TOOL_INPUT_SCHEMA,
      inputSchema: chapterDetailOperationInputSchema,
      outputSchema: chapterDetailOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const chapter = await readChapterDetail({
          projectId: ctx.projectId,
          episodeId,
          chapterId: input.chapterId,
        })
        return chapterDetailOutputSchema.parse({ chapter })
      },
    }),
    revise_bible: defineOperation({
      id: 'revise_bible',
      summary: 'Apply explicit user-reviewed revisions to the episode planning baseline and regenerate the chapter split.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BIBLE_WRITE,
      confirmation: {
        required: true,
        summary: '将覆盖当前剧集规划基线（全局 Bible、节拍、台账、情绪曲线和章节切分）。若已有下游章节产物，操作会失败。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_REVISE_BIBLE_TOOL_INPUT_SCHEMA,
      inputSchema: reviseBibleOperationInputSchema,
      outputSchema: editBibleMutationOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const result = await reviseEpisodeEditBible({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          patch: {
            ...(input.bible ? { bible: input.bible } : {}),
            ...(input.beatSheet ? { beatSheet: input.beatSheet } : {}),
            ...(input.ledger ? { ledger: input.ledger } : {}),
            ...(input.emotionalCurve ? { emotionalCurve: input.emotionalCurve } : {}),
          },
        })
        return editBibleMutationOutputSchema.parse(result)
      },
    }),
    confirm_bible: defineOperation({
      id: 'confirm_bible',
      summary: 'Confirm and lock the current episode planning baseline so chapter production can proceed from a stable global state.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BIBLE_WRITE,
      confirmation: {
        required: true,
        summary: '将确认并锁定当前剧集规划基线，之后不能直接替换源剧本。确认继续后请重新调用并传入 confirmed=true。',
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: confirmBibleOperationInputSchema,
      outputSchema: editBibleMutationOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = resolveEpisodeId(input, ctx.context.episodeId)
        const editBible = await confirmEpisodeEditBible({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
        })
        return editBibleMutationOutputSchema.parse({ editBible })
      },
    }),
  }
}
