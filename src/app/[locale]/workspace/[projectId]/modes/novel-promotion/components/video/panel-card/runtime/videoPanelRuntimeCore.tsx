'use client'

import { logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import type { VideoPanelCardShellProps } from '../types'
import { EMPTY_RUNNING_VOICE_LINE_IDS } from './shared'
import { usePanelTaskStatus } from './hooks/usePanelTaskStatus'
import { usePanelVideoModel } from './hooks/usePanelVideoModel'
import { usePanelPlayer } from './hooks/usePanelPlayer'
import { usePanelPromptEditor } from './hooks/usePanelPromptEditor'
import { usePanelVoiceManager } from './hooks/usePanelVoiceManager'
import { usePanelLipSync } from './hooks/usePanelLipSync'
import { usePanelVideoDurationBinding } from './hooks/usePanelVideoDurationBinding'
import { useDownloadRemoteBlob } from '@/lib/query/hooks'
import { getErrorMessage } from '@/lib/novel-promotion/stages/video-stage-runtime/utils'

function inferVideoExtension(url: string, mimeType?: string | null): string {
  if (mimeType) {
    if (mimeType.includes('webm')) return 'webm'
    if (mimeType.includes('quicktime')) return 'mov'
    if (mimeType.includes('x-matroska')) return 'mkv'
    if (mimeType.includes('avi')) return 'avi'
    if (mimeType.includes('mp4')) return 'mp4'
  }

  try {
    const parsed = new URL(url, window.location.origin)
    const match = parsed.pathname.match(/\.([a-z0-9]+)$/i)
    if (match?.[1]) return match[1].toLowerCase()
  } catch {
    // Ignore parse failures and fall back to mp4.
  }

  return 'mp4'
}

export function useVideoPanelActions({
  panel,
  panelIndex,
  defaultVideoModel,
  capabilityOverrides,
  videoRatio = '16:9',
  userVideoModels,
  lipSyncEnabled = false,
  projectId,
  episodeId,
  runningVoiceLineIds = EMPTY_RUNNING_VOICE_LINE_IDS,
  matchedVoiceLines = [],
  onLipSync,
  showLipSyncVideo,
  onToggleLipSyncVideo,
  isLinked,
  isLastFrame,
  nextPanel,
  prevPanel,
  hasNext,
  flModel,
  flModelOptions,
  flGenerationOptions,
  flCapabilityFields,
  flMissingCapabilityFields,
  flCustomPrompt,
  defaultFlPrompt,
  localPrompt,
  isSavingPrompt,
  onUpdateLocalPrompt,
  onSavePrompt,
  onGenerateVideo,
  onUpdatePanelVideoModel,
  onUpdatePanelVideoDurationBinding,
  onRestorePreviousVideo,
  onToggleLink,
  onFlModelChange,
  onFlCapabilityChange,
  onFlCustomPromptChange,
  onResetFlPrompt,
  onGenerateFirstLastFrame,
  onPreviewImage,
}: VideoPanelCardShellProps) {
  const t = useTranslations('video')
  const tCommon = useTranslations('common')
  const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
  const isFirstLastFrameOutput = panel.videoGenerationMode === 'firstlastframe' && !!panel.videoUrl
  const visibleBaseVideoUrl = (() => {
    if (isLinked) return isFirstLastFrameOutput ? panel.videoUrl : undefined
    if (isLastFrame) return undefined
    return panel.videoUrl
  })()
  const hasVisibleBaseVideo = !!visibleBaseVideoUrl

  const taskStatus = usePanelTaskStatus({
    panel,
    hasVisibleBaseVideo,
    lipSyncEnabled,
    tCommon: (key: string) => tCommon(key as never),
  })

  const effectiveShowLipSyncVideo = lipSyncEnabled ? showLipSyncVideo : false

  const videoModel = usePanelVideoModel({
    defaultVideoModel,
    capabilityOverrides,
    userVideoModels,
  })

  const player = usePanelPlayer({
    videoRatio,
    imageUrl: panel.imageUrl,
    videoUrl: visibleBaseVideoUrl,
    lipSyncVideoUrl: panel.lipSyncVideoUrl,
    showLipSyncVideo: effectiveShowLipSyncVideo,
    onPreviewImage,
  })
  const downloadRemoteBlobMutation = useDownloadRemoteBlob()

  const promptEditor = usePanelPromptEditor({
    localPrompt,
    onUpdateLocalPrompt,
    onSavePrompt,
  })

  const voiceManager = usePanelVoiceManager({
    projectId,
    episodeId,
    matchedVoiceLines,
    runningVoiceLineIds,
    audioFailedMessage: t('panelCard.error.audioFailed'),
  })

  const lipSync = usePanelLipSync({
    panel,
    matchedVoiceLines,
    onLipSync,
  })

  const durationBinding = usePanelVideoDurationBinding({
    binding: panel.videoDurationBinding,
    matchedVoiceLines,
    selectedModel: videoModel.selectedModel,
  })

  const handleDownloadVideo = useCallback(async () => {
    const targetUrl = player.currentVideoUrl
    if (!targetUrl) return

    try {
      const blob = await downloadRemoteBlobMutation.mutateAsync(targetUrl)
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const isLipSyncVideo = !!panel.lipSyncVideoUrl && targetUrl === panel.lipSyncVideoUrl
      const extension = inferVideoExtension(targetUrl, blob.type)

      anchor.href = objectUrl
      anchor.download = `shot-${panelIndex + 1}-${isLipSyncVideo ? 'lip-sync' : 'video'}.${extension}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
    } catch (error) {
      _ulogError('[video] single download failed', error)
      alert(`${t('stage.downloadFailed')}: ${getErrorMessage(error) || t('errors.unknownError')}`)
    }
  }, [downloadRemoteBlobMutation, panel.lipSyncVideoUrl, panelIndex, player.currentVideoUrl, t])

  const showLipSyncSection = lipSyncEnabled && voiceManager.hasMatchedVoiceLines
  const canLipSync = lipSyncEnabled && hasVisibleBaseVideo && voiceManager.hasMatchedAudio && !taskStatus.isLipSyncTaskRunning

  return {
    t,
    tCommon,
    panel,
    panelIndex,
    panelKey,
    media: {
      lipSyncEnabled,
      showLipSyncVideo: effectiveShowLipSyncVideo,
      onToggleLipSyncVideo,
      onPreviewImage,
      baseVideoUrl: visibleBaseVideoUrl,
      currentVideoUrl: player.currentVideoUrl,
    },
    download: {
      isDownloadingVideo: downloadRemoteBlobMutation.isPending,
      canDownloadCurrentVideo: !!player.currentVideoUrl,
    },
    taskStatus,
    videoModel,
    durationBinding,
    player,
    promptEditor: {
      ...promptEditor,
      localPrompt,
      isSavingPrompt,
    },
    voiceManager,
    lipSync,
    layout: {
      isLinked,
      isLastFrame,
      nextPanel,
      prevPanel,
      hasNext,
      flModel,
      flModelOptions,
      flGenerationOptions,
      flCapabilityFields,
      flMissingCapabilityFields,
      flCustomPrompt,
      defaultFlPrompt,
      videoRatio,
    },
    actions: {
      onGenerateVideo,
      onRestorePreviousVideo,
      onDownloadVideo: handleDownloadVideo,
      onUpdatePanelVideoModel,
      onUpdatePanelVideoDurationBinding,
      onToggleLink,
      onFlModelChange,
      onFlCapabilityChange,
      onFlCustomPromptChange,
      onResetFlPrompt,
      onGenerateFirstLastFrame,
    },
    computed: {
      showLipSyncSection,
      canLipSync,
      hasVisibleBaseVideo,
    },
  }
}

export type VideoPanelRuntime = ReturnType<typeof useVideoPanelActions>
