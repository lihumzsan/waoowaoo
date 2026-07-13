import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import type { TaskBatchSubmittedPartData, TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA } from '@/lib/project-workflow/edit-first-tool-input-schema'
import { EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA } from '@/lib/project-workflow/edit-first-tool-input-schema'
import { submitOperationTask, submitOperationTaskBatch } from '@/lib/operations/submit-operation-task'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { createTaskBatchKey } from '@/lib/task/batch'
import { resolveEditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { ApiError } from '@/lib/api-errors'

const finalRenderInputSchema = z.object({
  episodeId: z.string().min(1).optional(),
  bgmVolume: z.number().min(0).max(1).optional(),
}).passthrough()

const renderChaptersInputSchema = z.object({
  episodeId: z.string().min(1).optional(),
  chapterId: z.string().trim().min(1).optional(),
  chapterIds: z.array(z.string().trim().min(1)).min(1).optional(),
}).passthrough()

type FinalRenderInput = z.infer<typeof finalRenderInputSchema>
type RenderChaptersInput = z.infer<typeof renderChaptersInputSchema>

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function resolveEpisodeId(input: FinalRenderInput, contextEpisodeId: unknown, projectId: string): Promise<string> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(contextEpisodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const episode = await prisma.projectEpisode.findFirst({
    where: { id: episodeId, projectId },
    select: { id: true },
  })
  if (!episode) throw new Error('PROJECT_AGENT_EPISODE_NOT_FOUND')
  return episode.id
}

async function assertFinalRenderAllowed(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
}): Promise<void> {
  const workflow = await resolveEditFirstWorkflowState(input)
  if (workflow.allowedOperationIds.includes('render_final_video')) return
  throw new ApiError('CONFLICT', {
    code: 'OPERATION_NOT_ALLOWED',
    operationId: 'render_final_video',
    workflowStage: workflow.stage,
    message: `EDIT_FIRST_FINAL_RENDER_NOT_ALLOWED:${workflow.stage}`,
  })
}

async function resolveRenderChapterTargets(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterIds?: readonly string[]
}): Promise<readonly { readonly id: string; readonly chapterIndex: number }[]> {
  const chapters = await prisma.projectEditChapter.findMany({
    where: {
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
      ...(input.chapterIds ? { id: { in: [...input.chapterIds] } } : {}),
    },
    orderBy: { chapterIndex: 'asc' },
    select: { id: true, chapterIndex: true },
  })
  if (chapters.length === 0) throw new Error(`PROJECT_AGENT_RENDER_CHAPTERS_REQUIRED:${input.episodeId}`)
  if (input.chapterIds && chapters.length !== input.chapterIds.length) {
    const foundIds = new Set(chapters.map((chapter) => chapter.id))
    const missingIds = input.chapterIds.filter((chapterId) => !foundIds.has(chapterId))
    throw new Error(`PROJECT_AGENT_RENDER_CHAPTERS_NOT_FOUND:${missingIds.join(',')}`)
  }
  return chapters
}

export function createFinalRenderOperations(): ProjectAgentOperationRegistryDraft {
  const taskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
    }).passthrough(),
  )
  const batchSubmitOutput = z.object({
    success: z.literal(true),
    async: z.literal(true),
    episodeId: z.string().min(1),
    batchKey: z.string().min(1),
    total: z.number().int().min(1),
    taskIds: z.array(z.string().min(1)),
    results: z.array(z.object({
      refId: z.string().min(1),
      taskId: z.string().min(1),
      taskType: z.literal(TASK_TYPE.CHAPTER_RENDER),
      targetType: z.literal('ProjectEditChapter'),
      targetId: z.string().min(1),
    })),
  }).passthrough()

  return {
    render_chapters: defineOperation({
      id: 'render_chapters',
      summary: 'Render each chapter into a chapter-level video from completed storyboard/video group outputs.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: renderChaptersInputSchema,
      outputSchema: batchSubmitOutput,
      execute: async (ctx, input: RenderChaptersInput) => {
        const episodeId = await resolveEpisodeId(input, ctx.context.episodeId, ctx.projectId)
        const chapters = await resolveRenderChapterTargets({
          projectId: ctx.projectId,
          episodeId,
          ...(input.chapterIds ? { chapterIds: input.chapterIds } : input.chapterId ? { chapterIds: [input.chapterId] } : {}),
        })
        const batchKey = createTaskBatchKey('render_chapters')
        const submissions = chapters.map((chapter) => {
          const payload: Record<string, unknown> = {
              episodeId,
              chapterId: chapter.id,
            }
          return {
              request: ctx.request,
              locale: resolveOperationLocale(ctx.context),
              userId: ctx.userId,
              projectId: ctx.projectId,
              episodeId,
              type: TASK_TYPE.CHAPTER_RENDER,
              targetType: 'ProjectEditChapter',
              targetId: chapter.id,
              operationId: 'render_chapters',
              source: ctx.source,
              payload,
              dedupeKey: `chapter_render:${ctx.projectId}:${episodeId}:${chapter.id}`,
              batchKey,
              billingInfo: null,
            }
        })
        const submittedResults = await submitOperationTaskBatch(submissions)
        const submitted = chapters.map((chapter, index) => {
          const result = submittedResults[index]
          if (!result) throw new Error(`RENDER_CHAPTER_TASK_RESULT_MISSING:${chapter.id}`)
          return { chapterId: chapter.id, taskId: result.taskId }
        })
        const output = batchSubmitOutput.parse({
          success: true,
          async: true,
          episodeId,
          batchKey,
          total: submitted.length,
          taskIds: submitted.map((item) => item.taskId),
          results: submitted.map((item) => ({
            refId: item.chapterId,
            taskId: item.taskId,
            taskType: TASK_TYPE.CHAPTER_RENDER,
            targetType: 'ProjectEditChapter',
            targetId: item.chapterId,
          })),
        })
        writeOperationDataPart<TaskBatchSubmittedPartData>(ctx.writer, 'data-task-batch-submitted', {
          operationId: 'render_chapters',
          total: output.total,
          taskTotal: output.total,
          targetTotal: output.total,
          taskIds: output.taskIds,
          results: output.results,
        })
        return output
      },
    }),
    render_final_video: defineOperation({
      id: 'render_final_video',
      summary: 'Render the final linear edited video with FFmpeg and completed episode music and soundscape layers.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: finalRenderInputSchema,
      outputSchema: taskSubmitOutput,
      execute: async (ctx, input) => {
        const episodeId = await resolveEpisodeId(input, ctx.context.episodeId, ctx.projectId)
        await assertFinalRenderAllowed({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
        })
        const payload: Record<string, unknown> = {
          episodeId,
          ...(typeof input.bgmVolume === 'number' ? { bgmVolume: input.bgmVolume } : {}),
        }

        const result = await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: ctx.projectId,
          episodeId,
          type: TASK_TYPE.FINAL_VIDEO_RENDER,
          targetType: 'ProjectEpisode',
          targetId: episodeId,
          operationId: 'render_final_video',
          source: ctx.source,
          payload,
          dedupeKey: `final_video_render:${episodeId}`,
          billingInfo: null,
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'render_final_video',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId,
          taskType: TASK_TYPE.FINAL_VIDEO_RENDER,
          targetType: 'ProjectEpisode',
          targetId: episodeId,
        })

        return {
          ...result,
          episodeId,
          taskType: TASK_TYPE.FINAL_VIDEO_RENDER,
          targetType: 'ProjectEpisode',
          targetId: episodeId,
        }
      },
    }),
  }
}
