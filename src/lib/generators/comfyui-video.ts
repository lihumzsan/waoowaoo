import { getProviderConfig } from '@/lib/api-config'
import { runComfyUiVideoWorkflow } from '@/lib/providers/comfyui/client'
import { COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID } from '@/lib/providers/comfyui/workflow-registry'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'

const COMFYUI_MULTI_SHOT_VBVR_WORKFLOW_ID = 'basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1'
const COMFYUI_MULTI_SHOT_WORKFLOW_PREFIX = 'basevideo/多镜头/'

const ASPECT_TO_SIZE: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1280, h: 736 },
  '9:16': { w: 736, h: 1280 },
  '3:4': { w: 960, h: 1280 },
  '4:3': { w: 1280, h: 960 },
  '3:2': { w: 1216, h: 832 },
  '2:3': { w: 832, h: 1216 },
}

const COMFYUI_VIDEO_DIMENSION_ALIGNMENT = 32

function alignComfyUiVideoDimension(value: number): number {
  return Math.max(
    64,
    Math.min(4096, Math.round(value / COMFYUI_VIDEO_DIMENSION_ALIGNMENT) * COMFYUI_VIDEO_DIMENSION_ALIGNMENT),
  )
}

function normalizeComfyUiVideoSize(size: { w: number; h: number } | null): { w: number; h: number } | null {
  if (!size) return null
  return {
    w: alignComfyUiVideoDimension(size.w),
    h: alignComfyUiVideoDimension(size.h),
  }
}

function hasStructuredPromptRelayPrompt(prompt: string): boolean {
  const value = prompt.trim()
  if (!value) return false
  const hasGlobalLocalSections = /(?:^|\n)\s*GLOBAL\s*[:：][\s\S]+(?:^|\n)\s*LOCAL\s*[:：]/i.test(value)
  const hasTimedSegments = /\[\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*\]/.test(value)
  return hasGlobalLocalSections || hasTimedSegments
}

function selectComfyUiVideoWorkflowKey(workflowKey: string, prompt: string): string {
  const normalizedWorkflowKey = workflowKey.trim()
  if (!normalizedWorkflowKey || normalizedWorkflowKey.startsWith(COMFYUI_MULTI_SHOT_WORKFLOW_PREFIX)) {
    return normalizedWorkflowKey
  }
  if (
    normalizedWorkflowKey === COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID
    && hasStructuredPromptRelayPrompt(prompt)
  ) {
    return COMFYUI_MULTI_SHOT_VBVR_WORKFLOW_ID
  }
  return normalizedWorkflowKey
}

function parseWxH(size: string | undefined): { w: number; h: number } | null {
  if (!size || typeof size !== 'string') return null
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(size.trim())
  if (!match) return null

  const w = Number(match[1])
  const h = Number(match[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64 || w > 4096 || h > 4096) {
    return null
  }
  return { w, h }
}

export class ComfyUIVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, imageUrl, prompt, options = {} } = params
    const providerId = typeof options.provider === 'string' ? options.provider : 'comfyui'
    const { baseUrl } = await getProviderConfig(userId, providerId)

    if (!baseUrl) {
      return {
        success: false,
        error: 'COMFYUI_BASE_URL_MISSING: configure your ComfyUI Base URL first',
      }
    }

    const workflowKey = typeof options.modelId === 'string' && options.modelId.trim()
      ? options.modelId.trim()
      : COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID
    const selectedWorkflowKey = selectComfyUiVideoWorkflowKey(workflowKey, prompt || '')
    const directSize = parseWxH(typeof options.size === 'string' ? options.size : undefined)
    const aspectSize = typeof options.aspectRatio === 'string'
      ? ASPECT_TO_SIZE[options.aspectRatio.trim()]
      : undefined
    const targetSize = normalizeComfyUiVideoSize(directSize || aspectSize || null)

    try {
      const { videoBase64, mimeType } = await runComfyUiVideoWorkflow({
        baseUrl,
        workflowKey: selectedWorkflowKey,
        prompt: prompt || '',
        firstFrameImageUrl: imageUrl,
        lastFrameImageUrl: typeof options.lastFrameImageUrl === 'string' ? options.lastFrameImageUrl : undefined,
        width: targetSize?.w,
        height: targetSize?.h,
        durationSeconds: typeof options.duration === 'number' ? options.duration : undefined,
        fps: typeof options.fps === 'number' ? options.fps : undefined,
      })

      return {
        success: true,
        videoUrl: `data:${mimeType};base64,${videoBase64}`,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      }
    }
  }
}
