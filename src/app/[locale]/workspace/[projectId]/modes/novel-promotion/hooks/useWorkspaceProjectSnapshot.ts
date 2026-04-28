'use client'

import { useMemo } from 'react'
import type { NovelPromotionWorkspaceProps } from '../types'
import type { CapabilitySelections } from '@/lib/model-config-contract'

const DEFAULT_VIDEO_MODEL = 'comfyui::basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1'
const LEGACY_DEFAULT_VIDEO_MODELS = new Set([
  'comfyui::basevideo/图生视频/LTX2.3图生视频快速版',
  'comfyui::basevideo/图生视频/ltx2.3-图生视频-没字幕版',
  'basevideo/图生视频/LTX2.3图生视频快速版',
  'basevideo/图生视频/ltx2.3-图生视频-没字幕版',
])

function parseCapabilitySelections(raw: unknown): CapabilitySelections {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as CapabilitySelections
  }
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as CapabilitySelections
  } catch {
    return {}
  }
}

function normalizeDefaultVideoModel(model: string | null | undefined): string | undefined {
  const value = typeof model === 'string' ? model.trim() : ''
  if (!value) return DEFAULT_VIDEO_MODEL
  return LEGACY_DEFAULT_VIDEO_MODELS.has(value) ? DEFAULT_VIDEO_MODEL : value
}

export function useWorkspaceProjectSnapshot({
  project,
  episode,
  urlStage,
}: Pick<NovelPromotionWorkspaceProps, 'project' | 'episode' | 'urlStage'>) {
  return useMemo(() => {
    const projectData = project.novelPromotionData
    const capabilityOverrides = parseCapabilitySelections(projectData?.capabilityOverrides)
    return {
      projectData,
      episodeStoryboards: episode?.storyboards || [],
      currentStage: urlStage === 'editor' ? 'videos' : (urlStage || 'config'),
      globalAssetText: projectData?.globalAssetText || '',
      novelText: episode?.novelText || '',
      analysisModel: projectData?.analysisModel,
      characterModel: projectData?.characterModel,
      locationModel: projectData?.locationModel,
      storyboardModel: projectData?.storyboardModel,
      editModel: projectData?.editModel,
      videoModel: normalizeDefaultVideoModel(projectData?.videoModel),
      audioModel: projectData?.audioModel,
      videoRatio: projectData?.videoRatio,
      capabilityOverrides,
      ttsRate: projectData?.ttsRate,
      artStyle: projectData?.artStyle,
    }
  }, [episode?.novelText, episode?.storyboards, project.novelPromotionData, urlStage])
}
