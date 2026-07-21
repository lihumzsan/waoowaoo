import type { VideoDurationBinding } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import { normalizeVideoModelKey } from '@/lib/novel-promotion/video-model-defaults'

type VideoGenerationOptionValue = string | number | boolean
type VideoGenerationOptions = Record<string, VideoGenerationOptionValue>

type FirstLastFrameRequest = {
  lastFrameStoryboardId: string
  lastFramePanelIndex: number
  flModel: string
  customPrompt?: string
}

export type VideoContinuityRelay = {
  mode: 'previous_output_end_frame'
  sourceVideoTaskId: string
  sourceFrameMediaId: string
}

export type GenerateVideoRequestParams = {
  storyboardId: string
  panelIndex: number
  videoModel: string
  panelId?: string
  generationOptions?: VideoGenerationOptions
  videoDurationBinding?: VideoDurationBinding
  firstLastFrame?: FirstLastFrameRequest
  continuityRelay?: VideoContinuityRelay
  customPrompt?: string
}

export type GenerateVideoRequestBody = {
  storyboardId: string
  panelIndex: number
  firstLastFrame?: FirstLastFrameRequest
  continuityRelay?: VideoContinuityRelay
  videoModel: string
  generationOptions?: VideoGenerationOptions
  videoDurationBinding?: VideoDurationBinding
  customPrompt?: string
}

function normalizeCustomPrompt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized : undefined
}

export function buildGenerateVideoRequestBody(params: GenerateVideoRequestParams): GenerateVideoRequestBody {
  const requestBody: GenerateVideoRequestBody = {
    storyboardId: params.storyboardId,
    panelIndex: params.panelIndex,
    videoModel: normalizeVideoModelKey(params.videoModel),
  }

  if (params.firstLastFrame) {
    requestBody.firstLastFrame = {
      ...params.firstLastFrame,
      flModel: normalizeVideoModelKey(params.firstLastFrame.flModel),
    }
  }
  if (params.continuityRelay) {
    requestBody.continuityRelay = params.continuityRelay
  }
  if (params.generationOptions && typeof params.generationOptions === 'object') {
    requestBody.generationOptions = params.generationOptions
  }
  if (params.videoDurationBinding && typeof params.videoDurationBinding === 'object') {
    requestBody.videoDurationBinding = params.videoDurationBinding
  }

  const customPrompt = normalizeCustomPrompt(params.customPrompt)
  if (customPrompt) {
    requestBody.customPrompt = customPrompt
  }

  return requestBody
}
