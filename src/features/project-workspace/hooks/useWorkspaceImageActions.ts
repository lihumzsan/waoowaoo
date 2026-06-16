'use client'

import { useCallback } from 'react'
import { useGenerateStoryboardGridImages, useRegenerateProjectPanelImage } from '@/lib/query/hooks'
import { useSelectProjectPanelCandidate } from '@/lib/query/mutations/storyboard-prompt-mutations'
import type { StoryboardPanelImageGenerationMode } from '@/lib/storyboard/grid-image-groups'

interface UseWorkspaceImageActionsParams {
  projectId: string
  episodeId?: string | null
}

export function useWorkspaceImageActions({
  projectId,
  episodeId,
}: UseWorkspaceImageActionsParams) {
  const regeneratePanelImageMutation = useRegenerateProjectPanelImage(projectId, episodeId)
  const generateStoryboardGridImagesMutation = useGenerateStoryboardGridImages(projectId, episodeId)
  const selectPanelCandidateMutation = useSelectProjectPanelCandidate(projectId, episodeId)

  const handleGeneratePanelImage = useCallback(async (panelId: string, count = 1) => {
    await regeneratePanelImageMutation.mutateAsync({ panelId, count })
  }, [regeneratePanelImageMutation])
  const handleGenerateStoryboardGridImages = useCallback(async (payload: {
    episodeId: string
    editScriptId: string
    sourceVideoBlockId: string
    panelIds: readonly string[]
    generationMode?: StoryboardPanelImageGenerationMode
  }) => {
    const generationMode = payload.generationMode ?? 'grid'
    if (generationMode === 'single') {
      for (const panelId of payload.panelIds) {
        await regeneratePanelImageMutation.mutateAsync({ panelId, count: 1 })
      }
      return
    }
    for (let index = 0; index < payload.panelIds.length; index += 4) {
      const panelIds = payload.panelIds.slice(index, index + 4)
      const panelId = panelIds[0]
      if (!panelId) continue
      if (panelIds.length === 1) {
        await regeneratePanelImageMutation.mutateAsync({ panelId, count: 1 })
        continue
      }
      await generateStoryboardGridImagesMutation.mutateAsync({
        episodeId: payload.episodeId,
        editScriptId: payload.editScriptId,
        sourceVideoBlockId: payload.sourceVideoBlockId,
        panelIds,
      })
    }
  }, [generateStoryboardGridImagesMutation, regeneratePanelImageMutation])
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
    handleGenerateStoryboardGridImages,
    handleSelectPanelCandidate,
    handleCancelPanelCandidate,
  }
}
