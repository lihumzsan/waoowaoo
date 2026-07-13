import { z } from 'zod'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA } from '@/lib/project-workflow/edit-first-tool-input-schema'
import {
  refineTaskBatchSubmitOperationOutputSchema,
  refineTaskSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { VIDEO_GRID_MODES } from '@/lib/video-groups/types'
import type { UnknownObject } from './shared'
import { commitGeneratePanelVideoPlan, planGeneratePanelVideoOperation } from './panel-video'
import {
  commitGenerateEpisodeVideoGroupsPlan,
  commitGenerateVideoGroupPlan,
  planGenerateEpisodeVideoGroupsOperation,
  planGenerateVideoGroupOperation,
} from './continuous-video-groups'
import { commitGenerateEpisodeVideosAutoPlan, planGenerateEpisodeVideosAutoOperation } from './episode-videos-auto'
import {
  commitGenerateAssetReferenceVideoPlan,
  commitGenerateEpisodeAssetReferenceVideosPlan,
  planGenerateAssetReferenceVideoOperation,
  planGenerateEpisodeAssetReferenceVideosOperation,
} from './asset-reference-video'

const generatePanelVideoInputSchema = z
  .object({
    panelId: z.string().min(1).optional(),
    storyboardId: z.string().min(1).optional(),
    panelIndex: z.number().int().min(0).max(2000).optional(),
    generationOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .refine((value) => Boolean(value.panelId || (value.storyboardId && typeof value.panelIndex === 'number')), {
    message: 'panelId or (storyboardId + panelIndex) is required',
    path: ['panelId'],
  })

const generateVideoGroupInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    chapterId: z.string().min(1),
    gridMode: z.enum(VIDEO_GRID_MODES),
    shotIds: z.array(z.string().trim().min(1)).min(1).max(9),
    generationOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const generateEpisodeVideoGroupsInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    chapterId: z.string().min(1),
    gridMode: z.enum(VIDEO_GRID_MODES),
    generationOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const generateEpisodeVideosAutoInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    chapterId: z.string().min(1).optional(),
    generationOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const generateAssetReferenceVideoInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    chapterId: z.string().min(1),
    segmentIndex: z.number().int().min(0).max(59),
    referenceImageUrls: z.array(z.string().trim().min(1)).min(1).max(8),
    generationOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const generateEpisodeAssetReferenceVideosInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    chapterId: z.string().min(1),
    referenceImageUrls: z.array(z.string().trim().min(1)).min(1).max(8),
    generationOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export function createVideoGenerationOperations(): ProjectAgentOperationRegistryDraft {
  const generatePanelVideoOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        mutationBatchId: z.string().min(1),
        panelId: z.string().min(1),
      })
      .passthrough(),
  )

  const generateVideoGroupOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        groupId: z.string().min(1),
        episodeId: z.string().min(1),
        chapterId: z.string().min(1).optional(),
        gridMode: z.enum(VIDEO_GRID_MODES),
        shotIds: z.array(z.string().min(1)),
        durationSec: z.number().int().positive(),
      })
      .passthrough(),
  )

  const generateEpisodeVideoGroupsOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase
      .extend({
        results: z.array(
          z
            .object({
              refId: z.string().min(1),
              taskId: z.string().min(1),
              shotIds: z.array(z.string().min(1)),
              durationSec: z.number().int().positive(),
            })
            .passthrough(),
        ),
        gridMode: z.enum(VIDEO_GRID_MODES),
      })
      .passthrough(),
  )

  const generateEpisodeVideosAutoOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase
      .extend({
        results: z.array(
          z
            .object({
              refId: z.string().min(1),
              taskId: z.string().min(1),
              kind: z.literal('group'),
              shotIds: z.array(z.string().min(1)),
              durationSec: z.number().int().positive().optional(),
            })
            .passthrough(),
        ),
        groupVideoModel: z.string().min(1),
        plan: z.object({
          items: z.array(
            z.object({
              kind: z.literal('group'),
              shotIds: z.array(z.string().min(1)),
              gridMode: z.enum(VIDEO_GRID_MODES).optional(),
              continuity: z.string().min(1),
            }),
          ),
        }),
      })
      .passthrough(),
  )

  const generateAssetReferenceVideoOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        groupId: z.string().min(1),
        episodeId: z.string().min(1),
        sourceMode: z.literal('asset_reference'),
        segmentIndex: z.number().int().min(0),
        shotIds: z.array(z.string().min(1)),
        durationSec: z.number().int().positive(),
      })
      .passthrough(),
  )

  const generateEpisodeAssetReferenceVideosOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase
      .extend({
        results: z.array(
          z
            .object({
              refId: z.string().min(1),
              taskId: z.string().min(1),
              shotIds: z.array(z.string().min(1)),
              durationSec: z.number().int().positive(),
            })
            .passthrough(),
        ),
        sourceMode: z.literal('asset_reference'),
      })
      .passthrough(),
  )

  return {
    generate_panel_video: defineOperation({
      id: 'generate_panel_video',
      summary: 'Generate video for a single storyboard panel.',
      intent: 'act',
      channels: { tool: false, api: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将为单个分镜格生成收费视频；用户批准当前不可变计划后执行。',
      },
      inputSchema: generatePanelVideoInputSchema,
      outputSchema: generatePanelVideoOutputSchema,
      plan: async (ctx, input) =>
        planGeneratePanelVideoOperation({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_panel_video',
        }),
      commit: async (ctx, input, plan) =>
        commitGeneratePanelVideoPlan({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_panel_video',
          plan,
        }),
    }),

    generate_episode_videos: defineOperation({
      id: 'generate_episode_videos',
      summary: 'Generate missing continuous video segments for the current episode from edit-first generation segments.',
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
        summary: '将按核心剪辑计划提交缺失的收费连续视频任务；用户批准当前不可变计划后执行。',
      },
      toolInputSchema: EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA,
      inputSchema: generateEpisodeVideosAutoInputSchema,
      outputSchema: generateEpisodeVideosAutoOutputSchema,
      plan: async (ctx, input) =>
        planGenerateEpisodeVideosAutoOperation({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_videos',
        }),
      commit: async (ctx, input, plan) =>
        commitGenerateEpisodeVideosAutoPlan({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_videos',
          plan,
        }),
    }),

    generate_video_group: defineOperation({
      id: 'generate_video_group',
      summary: 'Generate one continuous video segment from ordered storyboard reference images.',
      intent: 'act',
      channels: { tool: false, api: true },
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将使用有序分镜参考图生成收费连续视频；用户批准当前不可变计划后执行。',
      },
      inputSchema: generateVideoGroupInputSchema,
      outputSchema: generateVideoGroupOutputSchema,
      plan: async (ctx, input) =>
        planGenerateVideoGroupOperation({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_video_group',
        }),
      commit: async (ctx, input, plan) =>
        commitGenerateVideoGroupPlan({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_video_group',
          plan,
        }),
    }),

    generate_episode_video_groups: defineOperation({
      id: 'generate_episode_video_groups',
      summary: 'Batch generate continuous video segments for an episode.',
      intent: 'act',
      channels: { tool: false, api: true },
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
        summary: '将按核心剪辑表批量生成收费连续视频；用户批准当前不可变计划后执行。',
      },
      inputSchema: generateEpisodeVideoGroupsInputSchema,
      outputSchema: generateEpisodeVideoGroupsOutputSchema,
      plan: async (ctx, input) =>
        planGenerateEpisodeVideoGroupsOperation({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_video_groups',
        }),
      commit: async (ctx, input, plan) =>
        commitGenerateEpisodeVideoGroupsPlan({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_video_groups',
          plan,
        }),
    }),

    generate_episode_videos_auto: defineOperation({
      id: 'generate_episode_videos_auto',
      summary: 'Generate episode videos from edit-first generation segments.',
      intent: 'act',
      channels: { tool: false, api: true },
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
        summary: '将按核心剪辑计划提交收费连续视频任务；用户批准当前不可变计划后执行。',
      },
      inputSchema: generateEpisodeVideosAutoInputSchema,
      outputSchema: generateEpisodeVideosAutoOutputSchema,
      plan: async (ctx, input) =>
        planGenerateEpisodeVideosAutoOperation({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_videos_auto',
        }),
      commit: async (ctx, input, plan) =>
        commitGenerateEpisodeVideosAutoPlan({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_videos_auto',
          plan,
        }),
    }),

    generate_asset_reference_video: defineOperation({
      id: 'generate_asset_reference_video',
      summary: 'Generate one edit-first generation segment directly from reference assets.',
      intent: 'act',
      channels: { tool: false, api: true },
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将使用参考资产图与结构化分段生成收费视频；用户批准当前不可变计划后执行。',
      },
      inputSchema: generateAssetReferenceVideoInputSchema,
      outputSchema: generateAssetReferenceVideoOutputSchema,
      plan: async (ctx, input) =>
        planGenerateAssetReferenceVideoOperation({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_asset_reference_video',
        }),
      commit: async (ctx, input, plan) =>
        commitGenerateAssetReferenceVideoPlan({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_asset_reference_video',
          plan,
        }),
    }),

    generate_episode_asset_reference_videos: defineOperation({
      id: 'generate_episode_asset_reference_videos',
      summary: 'Batch generate edit-first generation segments directly from reference assets.',
      intent: 'act',
      channels: { tool: false, api: true },
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
        summary: '将使用参考资产图与结构化分段批量生成收费视频；用户批准当前不可变计划后执行。',
      },
      inputSchema: generateEpisodeAssetReferenceVideosInputSchema,
      outputSchema: generateEpisodeAssetReferenceVideosOutputSchema,
      plan: async (ctx, input) =>
        planGenerateEpisodeAssetReferenceVideosOperation({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_asset_reference_videos',
        }),
      commit: async (ctx, input, plan) =>
        commitGenerateEpisodeAssetReferenceVideosPlan({
          ctx,
          input: input as UnknownObject,
          operationId: 'generate_episode_asset_reference_videos',
          plan,
        }),
    }),
  }
}
ensureAiCatalogsRegistered()
