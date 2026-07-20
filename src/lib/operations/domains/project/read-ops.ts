import { z } from 'zod'
import { queryTaskTargetStates } from '@/lib/task/state-service'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { assembleProjectContext } from '@/lib/project-context/assembler'
import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import { assembleProjectProjectionFull } from '@/lib/project-projection/full'
import { buildAssistantProjectContextSnapshot } from '@/lib/project-agent/presentation'
import { listTaskBatchFailures, readTaskBatchStatus } from '@/lib/task/batch'
import type {
  ProjectContextPartData,
} from '@/lib/project-agent/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { readProjectCreativeResourceWorkingSet } from '@/lib/creative-resource/view-service'

const taskTargetSchema = z.object({
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  types: z.array(z.string().min(1)).optional(),
})

const taskBatchSchema = z.object({
  batchKey: z.string().trim().min(1),
  includeFailures: z.boolean().optional(),
})

const EFFECTS_NONE = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseProjectionSegmentId(scopeRef: string | undefined): string | null {
  const normalized = normalizeString(scopeRef)
  if (!normalized) return null
  if (!normalized.startsWith('video-segment:')) return null
  return normalizeString(normalized.slice('video-segment:'.length)) || null
}

export function createReadOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_snapshot: defineOperation({
      id: 'get_project_snapshot',
      summary: 'Read detailed project projection only when the injected project_state_snapshot and conversation context are insufficient for a concrete user request or user-intent tool input. Do not call merely to confirm the current phase, progress, next action, projectId, episodeId, approval state, general status, or system-derived tool parameters. Use detail=full only when video segment status or output identity is explicitly needed.',
      intent: 'query',
      effects: EFFECTS_NONE,
      inputSchema: z.object({
        detail: z.enum(['lite', 'full']).optional(),
        scopeRef: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => (input.detail === 'full'
        ? assembleProjectProjectionFull({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId: ctx.context.episodeId || null,
            selectedScopeRef: input.scopeRef,
            segmentId: parseProjectionSegmentId(input.scopeRef),
          })
        : assembleProjectProjectionLite({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId: ctx.context.episodeId || null,
          })),
    }),
    get_project_context: defineOperation({
      id: 'get_project_context',
      summary: 'Read the compact current project working set: exact confirmed screenplay and adopted Style Bible bindings, project configuration, active work, and professional domain state. Use list_resources to browse candidates/history and get_resource to read one exact full revision; never infer current adoption from latest resources, history, Canvas, or chat.',
      intent: 'query',
      effects: EFFECTS_NONE,
      inputSchema: z.object({
        detail: z.enum(['snapshot', 'full']).optional(),
        selectedScopeRef: z.string().optional(),
        selectedAssetId: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episodeId = ctx.context.episodeId || null
        const [projectContext, creativeWorkingSet] = await Promise.all([
          assembleProjectContext({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
            selectedScopeRef: normalizeString(input.selectedScopeRef) || ctx.context.selectedScopeRef || null,
            selectedAssetId: normalizeString(input.selectedAssetId) || ctx.context.selectedAssetId || null,
          }),
          readProjectCreativeResourceWorkingSet({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
          }),
        ])
        const agentPolicy = {
          projectId: projectContext.policy.projectId,
          episodeId: projectContext.policy.episodeId,
          videoRatio: projectContext.policy.videoRatio,
          overrides: projectContext.policy.overrides,
        }
        const agentProjectContext = {
          ...projectContext,
          policy: agentPolicy,
        }
        const snapshot = buildAssistantProjectContextSnapshot(projectContext)
        writeOperationDataPart<ProjectContextPartData>(ctx.writer, 'data-project-context', {
          context: snapshot,
        })
        if (input.detail === 'full') return { ...agentProjectContext, creativeWorkingSet }
        return { ...snapshot, creativeWorkingSet }
      },
    }),
    get_task_status: defineOperation({
      id: 'get_task_status',
      summary: 'Query task target states for one or more project targets.',
      intent: 'query',
      effects: EFFECTS_NONE,
      inputSchema: z.object({
        targets: z.array(taskTargetSchema).min(1).max(500),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => ({
        states: await withRetry({
          scope: 'prisma:get_task_status',
          policy: RETRY_POLICY.prisma,
          run: async () => await queryTaskTargetStates({
            projectId: ctx.projectId,
            userId: ctx.userId,
            targets: input.targets,
          }),
        }),
      }),
    }),
    get_task_batch: defineOperation({
      id: 'get_task_batch',
      summary: 'Read aggregate status for a submitted task batch by batchKey, optionally including failed task details.',
      intent: 'query',
      effects: EFFECTS_NONE,
      inputSchema: taskBatchSchema,
      outputSchema: z.unknown(),
      execute: async (_ctx, input) => {
        const status = await readTaskBatchStatus(input.batchKey)
        return {
          status,
          failures: input.includeFailures === true
            ? await listTaskBatchFailures(input.batchKey)
            : [],
        }
      },
    }),
  }
}
