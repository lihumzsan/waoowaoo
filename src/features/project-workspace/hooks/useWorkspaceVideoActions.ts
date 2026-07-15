'use client'

import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { usePlanBgmDesign, useRenderFinalVideo } from '@/lib/query/hooks/useFinalMedia'

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
  const planBgmDesignMutation = usePlanBgmDesign(projectId, episodeId || null)
  const renderFinalVideoMutation = useRenderFinalVideo(projectId, episodeId || null)

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
      await planBgmDesignMutation.mutateAsync()
    } catch (err: unknown) {
      if (isAbortError(err)) {
        _ulogInfo(t('execution.requestAborted'))
        return
      }
      alert(`${t('execution.bgmPlanFailed')}: ${getErrorMessage(err)}`)
      throw err
    }
  }

  return {
    handlePlanBgmScore,
    handleRenderFinalVideo,
  }
}
