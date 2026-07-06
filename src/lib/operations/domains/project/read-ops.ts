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

function parseProjectionScope(scopeRef: string | undefined): { storyboardId?: string | null; panelId?: string | null } | null {
  const normalized = normalizeString(scopeRef)
  if (!normalized) return null
  if (normalized.startsWith('storyboard:')) {
    const storyboardId = normalized.slice('storyboard:'.length).trim()
    return storyboardId ? { storyboardId } : null
  }
  if (normalized.startsWith('panel:')) {
    const panelId = normalized.slice('panel:'.length).trim()
    return panelId ? { panelId } : null
  }
  return null
}

export function createReadOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_snapshot: defineOperation({
      id: 'get_project_snapshot',
      summary: 'Read detailed project projection only when the injected project_state_snapshot and conversation context are insufficient for a concrete user request or user-intent tool input. Do not call merely to confirm the current phase, progress, next action, projectId, episodeId, approval state, general status, or system-derived tool parameters. Use detail=full only when panel fields, prompts, descriptions, or media URLs are explicitly needed.',
      intent: 'query',
      effects: EFFECTS_NONE,
      inputSchema: z.object({
        detail: z.enum(['lite', 'full']).optional(),
        panelLimit: z.number().int().positive().max(1000).optional(),
        scopeRef: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => (input.detail === 'full'
        ? assembleProjectProjectionFull({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId: ctx.context.episodeId || null,
            panelLimit: input.panelLimit,
            scope: parseProjectionScope(input.scopeRef) ?? null,
          })
        : assembleProjectProjectionLite({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId: ctx.context.episodeId || null,
          })),
    }),
    get_project_context: defineOperation({
      id: 'get_project_context',
      summary: 'Load concrete project or episode details only when the injected project_state_snapshot and conversation context are insufficient for the requested content or user-intent tool input, such as full bible text, historical operation results, failure details, active task details, or asset/storyboard/panel fields. Do not call merely to confirm the current phase, progress, next action, projectId, episodeId, approval state, or system-derived tool parameters.',
      intent: 'query',
      effects: EFFECTS_NONE,
      inputSchema: z.object({
        detail: z.enum(['snapshot', 'full']).optional(),
        selectedScopeRef: z.string().optional(),
        selectedPanelId: z.string().optional(),
        selectedAssetId: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const projectContext = await assembleProjectContext({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId: ctx.context.episodeId || null,
          selectedScopeRef: normalizeString(input.selectedScopeRef) || ctx.context.selectedScopeRef || null,
          selectedPanelId: normalizeString(input.selectedPanelId) || ctx.context.selectedPanelId || null,
          selectedAssetId: normalizeString(input.selectedAssetId) || ctx.context.selectedAssetId || null,
        })
        const snapshot = buildAssistantProjectContextSnapshot(projectContext)
        writeOperationDataPart<ProjectContextPartData>(ctx.writer, 'data-project-context', {
          context: snapshot,
        })
        if (input.detail === 'full') return projectContext
        return snapshot
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
