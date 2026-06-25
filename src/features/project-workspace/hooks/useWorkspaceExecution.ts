'use client'

import { useCallback } from 'react'
import { dispatchWorkspaceAssistantMessage } from '../components/workspace-assistant/assistant-send-event'

interface UseWorkspaceExecutionParams {
  projectId: string
  episodeId?: string
  analysisModel?: string | null
  novelText: string
  t: (key: string) => string
  onRefresh: (options?: { scope?: string; mode?: string }) => Promise<void>
  onOpenAssetLibrary: (focusCharacterId?: string | null, refreshAssets?: boolean) => void
}

export function useWorkspaceExecution({
  projectId,
  episodeId,
  t,
}: UseWorkspaceExecutionParams) {
  const requestAssistantGuidance = useCallback(async () => {
    dispatchWorkspaceAssistantMessage({
      key: `assistant-guidance-request:${projectId}:${episodeId || 'global'}:${Date.now().toString(36)}`,
      message: t('execution.assistantGuidanceRequest'),
    })
  }, [episodeId, projectId, t])

  return {
    isConfirmingAssets: false,
    isTransitioning: false,
    transitionProgress: { message: '', step: '' },
    requestAssistantGuidance,
    showCreatingToast: false,
  }
}
