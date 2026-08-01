'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'
import type { CanvasActionCatalogView } from '@/lib/operations/canvas-action-catalog'

interface CanvasActionCatalogResponse {
  readonly success: true
  readonly catalog: CanvasActionCatalogView
}

export function useCanvasActions(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'canvas-actions'] as const,
    queryFn: async (): Promise<CanvasActionCatalogView> => {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas-actions`)
      if (!response.ok) throw await readClientApiError(response)
      const payload = await response.json() as CanvasActionCatalogResponse
      return payload.catalog
    },
    enabled: Boolean(projectId),
    staleTime: 60_000,
  })
}
