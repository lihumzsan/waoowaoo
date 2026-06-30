'use client'

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { buildBatchVideoGenerationPlanRequest } from '@/lib/query/media-operation-plan-input'
import {
  buildOperationPlanBillingText,
  fetchOperationPlanView,
} from '@/lib/query/operation-plan-client'
import { queryKeys } from '@/lib/query/keys'
import type {
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeAction,
} from '../node-canvas-types'

export interface WorkspaceCanvasActionPlanRequest {
  readonly cacheKey: string
  readonly operationId: string
  readonly input: Record<string, unknown>
  readonly context?: Record<string, unknown>
}

interface WorkspaceCanvasActionBillingPreviewParams {
  readonly projectId?: string | null
  readonly episodeId?: string | null
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly withCredits: (values: { count: number; cost: number }) => string
  readonly withoutCredits: (values: { count: number }) => string
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

function definedRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

export function resolveWorkspaceCanvasActionPlanRequest(params: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly action: WorkspaceCanvasNodeAction
}): WorkspaceCanvasActionPlanRequest | null {
  const context = params.episodeId ? { episodeId: params.episodeId } : undefined
  if (params.action.type === 'generate_image') {
    const input = { panelId: params.action.panelId }
    return {
      cacheKey: buildCacheKey({
        projectId: params.projectId,
        episodeId: params.episodeId,
        operationId: 'regenerate_panel_image',
        input,
        context,
      }),
      operationId: 'regenerate_panel_image',
      input,
      context,
    }
  }
  if (params.action.type === 'generate_storyboard_grid_images') {
    const input = {
      episodeId: params.action.episodeId,
      editScriptId: params.action.editScriptId,
      sourceGenerationSegmentId: params.action.sourceGenerationSegmentId,
      panelIds: [...params.action.panelIds],
    }
    return {
      cacheKey: buildCacheKey({
        projectId: params.projectId,
        episodeId: params.episodeId,
        operationId: 'generate_storyboard_grid_images',
        input,
        context,
      }),
      operationId: 'generate_storyboard_grid_images',
      input,
      context,
    }
  }
  if (params.action.type === 'generate_video') {
    const input = definedRecord({
      storyboardId: params.action.storyboardId,
      panelIndex: params.action.panelIndex,
      panelId: params.action.panelId,
      generationOptions: params.action.generationOptions,
    })
    return {
      cacheKey: buildCacheKey({
        projectId: params.projectId,
        episodeId: params.episodeId,
        operationId: 'generate_panel_video',
        input,
        context,
      }),
      operationId: 'generate_panel_video',
      input,
      context,
    }
  }
  if (params.action.type === 'generate_all_videos' && params.episodeId) {
    const request = buildBatchVideoGenerationPlanRequest({
      episodeId: params.episodeId,
      generationOptions: params.action.generationOptions,
    })
    return {
      cacheKey: buildCacheKey({
        projectId: params.projectId,
        episodeId: params.episodeId,
        operationId: request.operationId,
        input: request.input,
        context,
      }),
      operationId: request.operationId,
      input: request.input,
      context,
    }
  }
  if (params.action.type === 'generate_video_group' && params.episodeId) {
    const request = buildBatchVideoGenerationPlanRequest({
      episodeId: params.episodeId,
      generationOptions: params.action.generationOptions,
      mode: 'grid',
      gridMode: params.action.gridMode,
      shotNumbers: params.action.shotNumbers,
    })
    return {
      cacheKey: buildCacheKey({
        projectId: params.projectId,
        episodeId: params.episodeId,
        operationId: request.operationId,
        input: request.input,
        context,
      }),
      operationId: request.operationId,
      input: request.input,
      context,
    }
  }
  if (params.action.type === 'generate_asset_reference_video' && params.episodeId) {
    const request = buildBatchVideoGenerationPlanRequest({
      episodeId: params.episodeId,
      generationOptions: params.action.generationOptions,
      mode: 'asset-reference',
      segmentIndex: params.action.segmentIndex,
      referenceImageUrls: params.action.referenceImageUrls,
    })
    return {
      cacheKey: buildCacheKey({
        projectId: params.projectId,
        episodeId: params.episodeId,
        operationId: request.operationId,
        input: request.input,
        context,
      }),
      operationId: request.operationId,
      input: request.input,
      context,
    }
  }
  if (params.action.type === 'generate_bgm_score' && params.episodeId) {
    const input = { episodeId: params.episodeId }
    return {
      cacheKey: buildCacheKey({
        projectId: params.projectId,
        episodeId: params.episodeId,
        operationId: 'generate_episode_bgm_score',
        input,
        context,
      }),
      operationId: 'generate_episode_bgm_score',
      input,
      context,
    }
  }
  return null
}

export function workspaceCanvasActionBillingPreviewKey(params: {
  readonly projectId?: string | null
  readonly episodeId?: string | null
  readonly action: WorkspaceCanvasNodeAction | undefined
}): string | null {
  if (!params.projectId || !params.action) return null
  return resolveWorkspaceCanvasActionPlanRequest({
    projectId: params.projectId,
    episodeId: params.episodeId,
    action: params.action,
  })?.cacheKey ?? null
}

function collectActionPlanRequests(params: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
}): readonly WorkspaceCanvasActionPlanRequest[] {
  const byKey = new Map<string, WorkspaceCanvasActionPlanRequest>()
  for (const node of params.nodes) {
    const actions = [node.data.action, node.data.secondaryAction, node.data.tertiaryAction]
    for (const action of actions) {
      if (!action) continue
      const request = resolveWorkspaceCanvasActionPlanRequest({
        projectId: params.projectId,
        episodeId: params.episodeId,
        action,
      })
      if (request) byKey.set(request.cacheKey, request)
    }
  }
  return [...byKey.values()]
}

export function useWorkspaceCanvasActionBillingPreviews({
  projectId,
  episodeId,
  nodes,
  withCredits,
  withoutCredits,
}: WorkspaceCanvasActionBillingPreviewParams): ReadonlyMap<string, string> {
  const requests = useMemo(
    () => projectId
      ? collectActionPlanRequests({ projectId, episodeId, nodes })
      : [],
    [episodeId, nodes, projectId],
  )
  const results = useQueries({
    queries: requests.map((request) => ({
      queryKey: queryKeys.operationPlans.preview(projectId ?? '', request.operationId, request.cacheKey),
      queryFn: () => {
        if (!projectId) throw new Error('PROJECT_ID_REQUIRED')
        return fetchOperationPlanView({
          projectId,
          operationId: request.operationId,
          input: request.input,
          context: request.context,
        })
      },
      enabled: Boolean(projectId),
      staleTime: 30_000,
    })),
  })

  return useMemo(() => {
    const previews = new Map<string, string>()
    requests.forEach((request, index) => {
      const plan = results[index]?.data
      if (!plan) return
      const label = buildOperationPlanBillingText({
        plan,
        withCredits,
        withoutCredits,
      })
      if (label) previews.set(request.cacheKey, label)
    })
    return previews
  }, [requests, results, withCredits, withoutCredits])
}
