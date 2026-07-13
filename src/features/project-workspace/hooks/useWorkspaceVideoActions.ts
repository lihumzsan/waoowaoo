'use client'

import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { usePlanBgmScore, usePlanSoundscape, useRenderFinalVideo } from '@/lib/query/hooks/useStoryboards'
import { useUpdateProjectPanelVideoPrompt, useUpdateProjectConfig } from '@/lib/query/hooks'

interface UseWorkspaceVideoActionsParams {
  projectId: string
  episodeId?: string
  t: (key: string) => string
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'AbortError' || err.message === 'Failed to fetch'
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function useWorkspaceVideoActions({
  projectId,
  episodeId,
  t,
}: UseWorkspaceVideoActionsParams) {
  const planBgmScoreMutation = usePlanBgmScore(projectId, episodeId || null)
  const planSoundscapeMutation = usePlanSoundscape(projectId, episodeId || null)
  const renderFinalVideoMutation = useRenderFinalVideo(projectId, episodeId || null)
  const updateProjectPanelVideoPromptMutation = useUpdateProjectPanelVideoPrompt(projectId, episodeId || null)
  const updateProjectConfigMutation = useUpdateProjectConfig(projectId)

  const handleRenderFinalVideo = async () => {
    if (!episodeId) {
      alert(t('execution.selectEpisode'))
      return
    }
    try {
      await renderFinalVideoMutation.mutateAsync()
    } catch (err: unknown) {
      if (isAbortError(err)) {
        _ulogInfo(t('execution.requestAborted'))
        return
      }
      alert(`${t('execution.finalRenderFailed')}: ${getErrorMessage(err)}`)
      throw err
    }
  }

  const handlePlanBgmScore = async () => {
    if (!episodeId) {
      alert(t('execution.selectEpisode'))
      return
    }
    try {
      await planBgmScoreMutation.mutateAsync()
    } catch (err: unknown) {
      if (isAbortError(err)) {
        _ulogInfo(t('execution.requestAborted'))
        return
      }
      alert(`${t('execution.bgmPlanFailed')}: ${getErrorMessage(err)}`)
      throw err
    }
  }

  const handlePlanSoundscape = async () => {
    if (!episodeId) {
      alert(t('execution.selectEpisode'))
      return
    }
    try {
      await planSoundscapeMutation.mutateAsync()
    } catch (err: unknown) {
      if (isAbortError(err)) {
        _ulogInfo(t('execution.requestAborted'))
        return
      }
      alert(`${t('execution.soundscapeFailed')}: ${getErrorMessage(err)}`)
      throw err
    }
  }

  const handleUpdateVideoPrompt = async (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field: 'imagePrompt' | 'videoPrompt' = 'videoPrompt',
  ) => {
    await updateProjectPanelVideoPromptMutation.mutateAsync({ storyboardId, panelIndex, value, field })
  }

  const handleUpdatePanelVideoModel = async (_storyboardId: string, _panelIndex: number, model: string) => {
    const normalizedModel = model.trim()
    if (!normalizedModel) return
    try {
      await updateProjectConfigMutation.mutateAsync({
        key: 'singleShotVideoModel',
        value: normalizedModel,
      })
    } catch (err: unknown) {
      _ulogError(`${t('execution.updateFailed')}:`, err)
    }
  }

  return {
    handlePlanBgmScore,
    handlePlanSoundscape,
    handleRenderFinalVideo,
    handleUpdateVideoPrompt,
    handleUpdatePanelVideoModel,
  }
}
