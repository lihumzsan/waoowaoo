import { z } from 'zod'
import { EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA } from '@/lib/project-workflow/edit-first-tool-input-schema'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  refineTaskBatchSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { commitGenerateVideoSegments, planGenerateVideoSegments } from '@/lib/video-segments/planning'

const inputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  chapterId: z.string().trim().min(1).nullable().optional(),
}).strict()

const outputSchema = refineTaskBatchSubmitOperationOutputSchema(
  taskBatchSubmitOperationOutputSchemaBase.extend({
    skippedCompletedCount: z.number().int().min(0),
    results: z.array(z.object({
      refId: z.string().min(1),
      taskId: z.string().min(1),
      taskType: z.literal('video_segment'),
      targetType: z.literal('ProjectVideoSegment'),
      targetId: z.string().uuid(),
    }).passthrough()),
  }).passthrough(),
)

export function createVideoSegmentOperations(): ProjectAgentOperationRegistryDraft {
  return {
    generate_video_segments: defineOperation({
      id: 'generate_video_segments',
      summary: 'Generate immutable full-reference videos for edit-first generation segments.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将按已批准资产、核心分段和镜头执行计划生成收费视频；批准后执行不可变任务计划。',
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema,
      outputSchema,
      plan: async (ctx, payload) => await planGenerateVideoSegments({
        ctx,
        operationId: 'generate_video_segments',
        payload,
      }),
      commit: async (ctx, _payload, plan) => await commitGenerateVideoSegments({
        ctx,
        operationId: 'generate_video_segments',
        plan,
      }),
    }),
  }
}
