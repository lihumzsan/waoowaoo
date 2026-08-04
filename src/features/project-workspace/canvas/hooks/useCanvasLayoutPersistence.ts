'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'
import { queryKeys } from '@/lib/query/keys'
import type {
  ProjectCanvasLayoutSnapshot,
  UpsertCanvasLayoutInput,
} from '@/lib/project-canvas/layout/canvas-layout-contract'
import { CANVAS_LAYOUT_SCHEMA_VERSION } from '@/lib/project-canvas/layout/canvas-layout-contract'
import {
  parseCanvasLayoutReadResponse,
  type CanvasLayoutReadWarningCode,
} from '@/lib/project-canvas/layout/canvas-layout-error-policy'

interface CanvasLayoutWriteResponse {
  readonly success: boolean
  readonly layout: ProjectCanvasLayoutSnapshot | null
}

interface CanvasLayoutPersistenceResult {
  readonly layout: ProjectCanvasLayoutSnapshot | null
  readonly warningCode: CanvasLayoutReadWarningCode | null
}

interface CanvasLayoutMutationContext {
  readonly previous: CanvasLayoutPersistenceResult | undefined
}

async function requireSuccessfulResponse(response: Response): Promise<void> {
  if (!response.ok) throw await readClientApiError(response)
}

export function buildOptimisticCanvasLayoutSnapshot(params: {
  readonly projectId: string
  readonly input: UpsertCanvasLayoutInput
}): ProjectCanvasLayoutSnapshot {
  return {
    projectId: params.projectId,
    folderKey: params.input.folderKey,
    schemaVersion: CANVAS_LAYOUT_SCHEMA_VERSION,
    viewport: params.input.viewport,
    nodeLayouts: params.input.nodeLayouts,
  }
}

async function readCanvasLayout(projectId: string, folderKey: string): Promise<CanvasLayoutPersistenceResult> {
  const search = new URLSearchParams({ folderKey })
  const response = await apiFetch(`/api/projects/${projectId}/canvas-layout?${search.toString()}`)
  await requireSuccessfulResponse(response)
  const payload = await response.json() as unknown
  return parseCanvasLayoutReadResponse(payload)
}

async function writeCanvasLayout(
  projectId: string,
  input: UpsertCanvasLayoutInput,
): Promise<ProjectCanvasLayoutSnapshot> {
  const response = await apiFetch(`/api/projects/${projectId}/canvas-layout`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  await requireSuccessfulResponse(response)
  const payload = await response.json() as CanvasLayoutWriteResponse
  if (!payload.layout) {
    throw new Error('canvas layout save returned empty layout')
  }
  return payload.layout
}


export function useCanvasLayoutPersistence(params: {
  readonly projectId: string
  readonly folderKey: string
}) {
  const queryClient = useQueryClient()
  const layoutQueryKey = queryKeys.project.canvasLayout(params.projectId, params.folderKey)
  const query = useQuery({
    queryKey: layoutQueryKey,
    queryFn: () => readCanvasLayout(params.projectId, params.folderKey),
    enabled: Boolean(params.projectId && params.folderKey),
  })

  const setLayoutCache = (layout: ProjectCanvasLayoutSnapshot | null) => {
    queryClient.setQueryData<CanvasLayoutPersistenceResult>(layoutQueryKey, {
      layout,
      warningCode: null,
    })
  }

  const restoreLayoutCache = (context: CanvasLayoutMutationContext | undefined) => {
    if (context?.previous !== undefined) {
      queryClient.setQueryData<CanvasLayoutPersistenceResult>(layoutQueryKey, context.previous)
      return
    }
    queryClient.removeQueries({ queryKey: layoutQueryKey, exact: true })
  }

  const mutation = useMutation({
    mutationFn: (input: UpsertCanvasLayoutInput) => writeCanvasLayout(params.projectId, input),
    onMutate: async (input): Promise<CanvasLayoutMutationContext> => {
      await queryClient.cancelQueries({ queryKey: layoutQueryKey })
      const previous = queryClient.getQueryData<CanvasLayoutPersistenceResult>(layoutQueryKey)
      setLayoutCache(buildOptimisticCanvasLayoutSnapshot({
        projectId: params.projectId,
        input,
      }))
      return { previous }
    },
    onSuccess: (savedLayout) => {
      setLayoutCache(savedLayout)
    },
    onError: (_error, _input, context) => {
      restoreLayoutCache(context)
    },
  })

  return {
    layout: query.data?.layout ?? null,
    layoutWarningCode: query.data?.warningCode ?? null,
    isLoading: query.isLoading,
    loadError: query.error,
    reloadLayout: query.refetch,
    saveLayout: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  }
}
