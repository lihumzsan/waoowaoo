'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  buildOperationPlanBillingPreview,
  fetchOperationPlanView,
} from '@/lib/query/operation-plan-client'
import type { BillingActionQuotePreview } from '@/lib/billing/action-quote-preview'
import type { OperationPlanView } from '@/lib/operations/planning'
import { queryKeys } from '@/lib/query/keys'
import type { WorkspaceCanvasNodeAction } from '../node-canvas-types'

export interface WorkspaceCanvasBillableActionRequest {
  readonly cacheKey: string
  readonly operationId: string
  readonly input: Record<string, unknown>
  readonly context?: Record<string, unknown>
}

const BILLABLE_CANVAS_ACTION_TYPES = new Set<WorkspaceCanvasNodeAction['type']>([
  'generate_video_segments',
  'generate_bgm_score',
  'generate_edit_assets',
  'generate_edit_asset',
  'regenerate_edit_asset_image',
])

export function isWorkspaceCanvasBillableAction(action: WorkspaceCanvasNodeAction): boolean {
  return BILLABLE_CANVAS_ACTION_TYPES.has(action.type)
}

function buildCacheKey(params: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly operationId: string
  readonly input: Record<string, unknown>
  readonly context?: Record<string, unknown>
}): string {
  return JSON.stringify({
    projectId: params.projectId,
    episodeId: params.episodeId ?? null,
    operationId: params.operationId,
    input: params.input,
    context: params.context ?? null,
  })
}

export function resolveWorkspaceCanvasBillableActionRequest(params: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly action: WorkspaceCanvasNodeAction
}): WorkspaceCanvasBillableActionRequest | null {
  const context = params.episodeId ? { episodeId: params.episodeId } : undefined
  let operationId: string
  let input: Record<string, unknown>

  switch (params.action.type) {
    case 'generate_video_segments': {
      if (!params.episodeId) return null
      operationId = 'generate_video_segments'
      input = {
        episodeId: params.episodeId,
        scope: params.action.scope,
      }
      break
    }
    case 'generate_bgm_score':
      if (!params.episodeId) return null
      operationId = 'generate_episode_bgm_score'
      input = { episodeId: params.episodeId }
      break
    case 'generate_edit_assets':
      if (!params.episodeId) return null
      operationId = 'generate_edit_script_assets'
      input = {
        episodeId: params.episodeId,
        editScriptId: params.action.editScriptId,
      }
      break
    case 'generate_edit_asset':
      if (!params.episodeId) return null
      operationId = 'generate_edit_script_assets'
      input = {
        episodeId: params.episodeId,
        editScriptId: params.action.editScriptId,
        requirementId: params.action.requirementId,
      }
      break
    case 'regenerate_edit_asset_image':
      if (!params.episodeId) return null
      operationId = 'api_assets_generate'
      input = {
        assetId: params.action.assetId,
        scope: 'project',
        kind: params.action.kind,
        projectId: params.projectId,
        episodeId: params.episodeId,
      }
      break
    default:
      return null
  }

  return {
    cacheKey: buildCacheKey({
      projectId: params.projectId,
      episodeId: params.episodeId,
      operationId,
      input,
      context,
    }),
    operationId,
    input,
    context,
  }
}

export function useWorkspaceCanvasBillableAction(params: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly action: WorkspaceCanvasNodeAction
  readonly withCredits: (values: { count: number; cost: number }) => string
  readonly withoutCredits: (values: { count: number }) => string
}): {
  readonly request: WorkspaceCanvasBillableActionRequest | null
  readonly plan: OperationPlanView | null
  readonly quote: BillingActionQuotePreview | null
  readonly loading: boolean
  readonly error: Error | null
} {
  const request = useMemo(() => resolveWorkspaceCanvasBillableActionRequest({
    projectId: params.projectId,
    episodeId: params.episodeId,
    action: params.action,
  }), [params.action, params.episodeId, params.projectId])
  const query = useQuery({
    queryKey: request
      ? queryKeys.operationPlans.preview(params.projectId, request.operationId, request.cacheKey)
      : ['workspace-canvas', 'non-billable-action'],
    queryFn: async () => {
      if (!request) throw new Error('WORKSPACE_CANVAS_BILLABLE_ACTION_REQUIRED')
      return await fetchOperationPlanView({
        projectId: params.projectId,
        operationId: request.operationId,
        input: request.input,
        context: request.context,
      })
    },
    enabled: Boolean(request),
    staleTime: 30_000,
  })
  const plan = query.data ?? null
  const quote = useMemo(() => plan ? buildOperationPlanBillingPreview({
    plan,
    withCredits: params.withCredits,
    withoutCredits: params.withoutCredits,
  }) : null, [params.withCredits, params.withoutCredits, plan])
  return {
    request,
    plan,
    quote,
    loading: Boolean(request && query.isPending),
    error: query.error instanceof Error ? query.error : null,
  }
}
