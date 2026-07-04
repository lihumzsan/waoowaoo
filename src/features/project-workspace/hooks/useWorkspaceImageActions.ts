'use client'

import { useCallback } from 'react'
import { useRegenerateProjectPanelImage } from '@/lib/query/hooks'
import { useSelectProjectPanelCandidate } from '@/lib/query/mutations/storyboard-prompt-mutations'

interface UseWorkspaceImageActionsParams {
  projectId: string
  episodeId?: string | null
}

export function useWorkspaceImageActions({
  projectId,
  episodeId,
}: UseWorkspaceImageActionsParams) {
  const regeneratePanelImageMutation = useRegenerateProjectPanelImage(projectId, episodeId)
  const selectPanelCandidateMutation = useSelectProjectPanelCandidate(projectId, episodeId)

  const handleGeneratePanelImage = useCallback(async (panelId: string, count = 1) => {
    await regeneratePanelImageMutation.mutateAsync({ panelId, count })
  }, [regeneratePanelImageMutation])
  const handleSelectPanelCandidate = useCallback(async (panelId: string, imageUrl: string) => {
    await selectPanelCandidateMutation.mutateAsync({
      panelId,
      selectedImageUrl: imageUrl,
      action: 'select',
    })
  }, [selectPanelCandidateMutation])
  const handleCancelPanelCandidate = useCallback(async (panelId: string) => {
    await selectPanelCandidateMutation.mutateAsync({
      panelId,
      action: 'cancel',
    })
  }, [selectPanelCandidateMutation])

  return {
    handleGeneratePanelImage,
    handleSelectPanelCandidate,
    handleCancelPanelCandidate,
  }
}
