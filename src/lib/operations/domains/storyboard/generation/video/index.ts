import { z } from 'zod'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  refineTaskBatchSubmitOperationOutputSchema,
  refineTaskSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { VIDEO_GRID_MODES } from '@/lib/video-groups/types'
import type { UnknownObject } from './shared'
import {
  commitGeneratePanelVideoPlan,
  executeGeneratePanelVideoOperation,
  planGeneratePanelVideoOperation,
} from './panel-video'
import {
  commitGenerateEpisodeVideosPlan,
  executeGenerateEpisodeVideosOperation,
  planGenerateEpisodeVideosOperation,
} from './episode-panel-videos'
import {
  commitGenerateEpisodeVideoGroupsPlan,
  commitGenerateVideoGroupPlan,
  executeGenerateEpisodeVideoGroupsOperation,
  executeGenerateVideoGroupOperation,
  planGenerateEpisodeVideoGroupsOperation,
  planGenerateVideoGroupOperation,
} from './continuous-video-groups'
import {
  commitGenerateEpisodeVideosAutoPlan,
  executeGenerateEpisodeVideosAutoOperation,
  planGenerateEpisodeVideosAutoOperation,
} from './episode-videos-auto'
import {
  commitGenerateAssetReferenceVideoPlan,
  commitGenerateEpisodeAssetReferenceVideosPlan,
  executeGenerateAssetReferenceVideoOperation,
  executeGenerateEpisodeAssetReferenceVideosOperation,
  planGenerateAssetReferenceVideoOperation,
  planGenerateEpisodeAssetReferenceVideosOperation,
} from './asset-reference-video'

const generatePanelVideoInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  panelId: z.string().min(1).optional(),
  storyboardId: z.string().min(1).optional(),
  panelIndex: z.number().int().min(0).max(2000).optional(),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough().refine((value) => Boolean(value.panelId || (value.storyboardId && typeof value.panelIndex === 'number')), {
  message: 'panelId or (storyboardId + panelIndex) is required',
  path: ['panelId'],
})

const generateEpisodeVideosInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(50).optional(),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateVideoGroupInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  gridMode: z.enum(VIDEO_GRID_MODES),
  shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateEpisodeVideoGroupsInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  gridMode: z.enum(VIDEO_GRID_MODES),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateEpisodeVideosAutoInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateAssetReferenceVideoInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  segmentIndex: z.number().int().min(0).max(59),
  referenceImageUrls: z.array(z.string().trim().min(1)).min(1).max(8),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateEpisodeAssetReferenceVideosInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  referenceImageUrls: z.array(z.string().trim().min(1)).min(1).max(8),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

export function createVideoGenerationOperations(): ProjectAgentOperationRegistryDraft {
  const generatePanelVideoOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      mutationBatchId: z.string().min(1),
      panelId: z.string().min(1),
    }).passthrough(),
  )

  const generateEpisodeVideosOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
      }).passthrough()),
    }).passthrough(),
  )

  const generateVideoGroupOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      groupId: z.string().min(1),
      episodeId: z.string().min(1),
      gridMode: z.enum(VIDEO_GRID_MODES),
      shotNumbers: z.array(z.number().int().positive()),
      durationSec: z.number().int().positive(),
    }).passthrough(),
  )

  const generateEpisodeVideoGroupsOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        shotNumbers: z.array(z.number().int().positive()),
        durationSec: z.number().int().positive(),
      }).passthrough()),
      gridMode: z.enum(VIDEO_GRID_MODES),
    }).passthrough(),
  )

  const generateEpisodeVideosAutoOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        kind: z.literal('group'),
        shotNumbers: z.array(z.number().int().positive()),
        durationSec: z.number().int().positive().optional(),
      }).passthrough()),
      groupVideoModel: z.string().min(1),
      plan: z.object({
        items: z.array(z.object({
          kind: z.literal('group'),
          shotNumbers: z.array(z.number().int().positive()),
          gridMode: z.enum(VIDEO_GRID_MODES).optional(),
          continuity: z.string().min(1),
        })),
      }),
    }).passthrough(),
  )

  const generateAssetReferenceVideoOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      groupId: z.string().min(1),
      episodeId: z.string().min(1),
      sourceMode: z.literal('asset_reference'),
      segmentIndex: z.number().int().min(0),
      shotNumbers: z.array(z.number().int().positive()),
      durationSec: z.number().int().positive(),
    }).passthrough(),
  )

  const generateEpisodeAssetReferenceVideosOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        shotNumbers: z.array(z.number().int().positive()),
        durationSec: z.number().int().positive(),
      }).passthrough()),
      sourceMode: z.literal('asset_reference'),
    }).passthrough(),
  )

  return {
    generate_panel_video: defineOperation({
      id: 'generate_panel_video',
      summary: 'Generate video for a single storyboard panel.',
      intent: 'act',
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将为单个分镜格生成视频（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generatePanelVideoInputSchema,
      outputSchema: generatePanelVideoOutputSchema,
      plan: async (ctx, input) => planGeneratePanelVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_panel_video',
      }),
      commit: async (ctx, input, plan) => commitGeneratePanelVideoPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_panel_video',
        plan,
      }),
      execute: async (ctx, input) => executeGeneratePanelVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_panel_video',
      }),
    }),

    generate_episode_videos: defineOperation({
      id: 'generate_episode_videos',
      summary: 'Batch generate videos for pending panels in an episode.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将为整集待生成分镜批量生成视频（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeVideosInputSchema,
      outputSchema: generateEpisodeVideosOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeVideosPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos',
      }),
    }),

    generate_video_group: defineOperation({
      id: 'generate_video_group',
      summary: 'Generate one continuous video segment from ordered storyboard reference images.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将使用一组有序分镜参考图生成连续视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateVideoGroupInputSchema,
      outputSchema: generateVideoGroupOutputSchema,
      plan: async (ctx, input) => planGenerateVideoGroupOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_video_group',
      }),
      commit: async (ctx, input, plan) => commitGenerateVideoGroupPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_video_group',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateVideoGroupOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_video_group',
      }),
    }),

    generate_episode_video_groups: defineOperation({
      id: 'generate_episode_video_groups',
      summary: 'Batch generate continuous video segments for an episode.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将按剪辑先行顺序批量生成连续视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeVideoGroupsInputSchema,
      outputSchema: generateEpisodeVideoGroupsOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeVideoGroupsOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_video_groups',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeVideoGroupsPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_video_groups',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeVideoGroupsOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_video_groups',
      }),
    }),

    generate_episode_videos_auto: defineOperation({
      id: 'generate_episode_videos_auto',
      summary: 'Generate episode videos from edit-first generation segments.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将按核心剪辑计划中的生成分段提交连续视频任务（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeVideosAutoInputSchema,
      outputSchema: generateEpisodeVideosAutoOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeVideosAutoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos_auto',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeVideosAutoPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos_auto',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeVideosAutoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos_auto',
      }),
    }),

    generate_asset_reference_video: defineOperation({
      id: 'generate_asset_reference_video',
      summary: 'Generate one edit-first generation segment directly from reference assets.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将使用参考资产图和结构化生成分段事实直接生成一个视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateAssetReferenceVideoInputSchema,
      outputSchema: generateAssetReferenceVideoOutputSchema,
      plan: async (ctx, input) => planGenerateAssetReferenceVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_asset_reference_video',
      }),
      commit: async (ctx, input, plan) => commitGenerateAssetReferenceVideoPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_asset_reference_video',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateAssetReferenceVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_asset_reference_video',
      }),
    }),

    generate_episode_asset_reference_videos: defineOperation({
      id: 'generate_episode_asset_reference_videos',
      summary: 'Batch generate edit-first generation segments directly from reference assets.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将使用参考资产图和结构化生成分段事实批量直接生成视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeAssetReferenceVideosInputSchema,
      outputSchema: generateEpisodeAssetReferenceVideosOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeAssetReferenceVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_asset_reference_videos',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeAssetReferenceVideosPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_asset_reference_videos',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeAssetReferenceVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_asset_reference_videos',
      }),
    }),
  }
}
ensureAiCatalogsRegistered()
