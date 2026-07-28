import { z } from 'zod'
import { queryTaskTargetStates } from '@/lib/task/state-service'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { assembleProjectContext } from '@/lib/project-context/assembler'
import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import { assembleProjectProjectionFull } from '@/lib/project-projection/full'
import { buildAssistantProjectContextSnapshot } from '@/lib/project-agent/presentation'
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

export function createReadOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_snapshot: defineOperation({
      id: 'get_project_snapshot',
      summary: 'Read the current project projection only when the injected project_state_snapshot and conversation context are insufficient for a concrete user request or user-intent tool input. Do not call merely to confirm general status, projectId, episodeId, approval state, or system-derived tool parameters.',
      intent: 'query',
      effects: EFFECTS_NONE,
      inputSchema: z.object({
        detail: z.enum(['lite', 'full']).optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => (input.detail === 'full'
        ? assembleProjectProjectionFull({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId: ctx.context.episodeId || null,
          })
        : assembleProjectProjectionLite({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId: ctx.context.episodeId || null,
          })),
    }),
    get_project_context: defineOperation({
      id: 'get_project_context',
      summary: 'Read the compact current project working set: exact adopted screenplay and Story Canon Resources, Creative Resource bindings, optional Chapter context units, project configuration, and active work. Use list_resources to browse candidates/history and get_resource to read one exact full Resource; never infer current adoption from latest resources, history, Canvas, or chat.',
      intent: 'query',
      toolExposure: 'direct',
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
      channels: { tool: false, api: true },
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
  }
}
