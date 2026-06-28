import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { readCompletedBgmScoreMix } from '@/lib/bgm-score/project-data'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'

const finalRenderInputSchema = z.object({
  confirmed: z.boolean().optional(),
  episodeId: z.string().min(1).optional(),
  bgmVolume: z.number().min(0).max(1).optional(),
}).passthrough()

type FinalRenderInput = z.infer<typeof finalRenderInputSchema>

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

async function assertCompletedBgmScore(episodeId: string): Promise<void> {
  const finalOutput = await prisma.projectEpisodeFinalOutput.findUnique({
    where: { episodeId },
    select: { bgmScoreJson: true },
  })
  const mix = readCompletedBgmScoreMix(finalOutput?.bgmScoreJson ?? null)
  if (!mix) throw new Error('PROJECT_AGENT_FINAL_RENDER_BGM_REQUIRED')
}

export function createFinalRenderOperations(): ProjectAgentOperationRegistryDraft {
  const taskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
    }).passthrough(),
  )

  return {
    render_final_video: defineOperation({
      id: 'render_final_video',
      summary: 'Render the final linear edited video with FFmpeg using the already generated episode BGM score.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将使用已生成的连续 BGM 与视频原声导出最终成片。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: finalRenderInputSchema,
      outputSchema: taskSubmitOutput,
      execute: async (ctx, input) => {
        const episodeId = await resolveEpisodeId(input, ctx.context.episodeId, ctx.projectId)
        await assertCompletedBgmScore(episodeId)
        const payload: Record<string, unknown> = {
          episodeId,
          ...(typeof input.bgmVolume === 'number' ? { bgmVolume: input.bgmVolume } : {}),
        }

        const result = await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          episodeId,
          type: TASK_TYPE.FINAL_VIDEO_RENDER,
          targetType: 'ProjectEpisode',
          targetId: episodeId,
          operationId: 'render_final_video',
          source: ctx.source,
          confirmed: input.confirmed === true,
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
