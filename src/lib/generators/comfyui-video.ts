import { getProviderConfig } from '@/lib/api-config'
import { isComfyUiWorkflowLlmApiRequired, runComfyUiVideoWorkflow } from '@/lib/providers/comfyui/client'
import { resolveComfyUiLlmApiConfig } from '@/lib/providers/comfyui/llm-api-config'
import { COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID } from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'

const COMFYUI_MULTI_SHOT_WORKFLOW_PREFIX = 'basevideo/多镜头/'
const COMFYUI_LTX23_PROFILE_WORKFLOW_PREFIX = 'basevideo/ltx23-profiles/'

const COMFYUI_SINGLE_SHOT_LTX23_WORKFLOW_ID = 'basevideo/\u56fe\u751f\u89c6\u9891/ltx2.3-\u56fe\u751f\u89c6\u9891-\u6ca1\u5b57\u5e55\u7248'
const COMFYUI_MULTI_SHOT_WORKFLOW_PREFIX_UNICODE = 'basevideo/\u591a\u955c\u5934/'

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

function isMultiShotWorkflowKey(workflowKey: string): boolean {
  return workflowKey.startsWith(COMFYUI_MULTI_SHOT_WORKFLOW_PREFIX)
    || workflowKey.startsWith(COMFYUI_MULTI_SHOT_WORKFLOW_PREFIX_UNICODE)
}

function isLtx23ProfileWorkflowKey(workflowKey: string): boolean {
  return workflowKey.startsWith(COMFYUI_LTX23_PROFILE_WORKFLOW_PREFIX)
}

function normalizeComfyUiReferenceImageUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const urls = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return urls.length > 0 ? urls : undefined
}

function normalizeComfyUiProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.startsWith('COMFYUI_LLM_MODEL_NOT_CONFIGURED')
    || message.startsWith('COMFYUI_LLM_MODEL_NOT_OPENROUTER')
    || message.startsWith('COMFYUI_WORKFLOW_NOT_FOUND')
  ) {
    return `MODEL_NOT_CONFIGURED: ${message}`
  }
  return message
}

export function selectComfyUiVideoWorkflowKey(
  workflowKey: string,
  prompt: string,
  options?: {
    generationMode?: unknown
    multiShotRange?: unknown
  },
): string {
  const normalizedWorkflowKey = workflowKey.trim()
  if (!normalizedWorkflowKey) {
    return normalizedWorkflowKey
  }
  if (isLtx23ProfileWorkflowKey(normalizedWorkflowKey)) {
    return normalizedWorkflowKey
  }
  const generationMode = options?.generationMode === 'firstlastframe' ? 'firstlastframe' : 'normal'
  const allowMultiShot = options?.multiShotRange === true
  if (generationMode === 'normal' && !allowMultiShot && isMultiShotWorkflowKey(normalizedWorkflowKey)) {
    return COMFYUI_SINGLE_SHOT_LTX23_WORKFLOW_ID
  }
  if (isMultiShotWorkflowKey(normalizedWorkflowKey)) {
    return normalizedWorkflowKey
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
      : COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID
    const selectedWorkflowKey = selectComfyUiVideoWorkflowKey(workflowKey, prompt || '', {
      generationMode: options.generationMode,
      multiShotRange: options.multiShotRange,
    })
    const directSize = parseWxH(typeof options.size === 'string' ? options.size : undefined)
    const aspectSize = typeof options.aspectRatio === 'string'
      ? ASPECT_TO_SIZE[options.aspectRatio.trim()]
      : undefined
    const targetSize = normalizeComfyUiVideoSize(directSize || aspectSize || null)

    try {
      const llmApi = isComfyUiWorkflowLlmApiRequired(selectedWorkflowKey)
        ? await resolveComfyUiLlmApiConfig({
            userId,
            analysisModel: typeof options.analysisModel === 'string' ? options.analysisModel : null,
          })
        : undefined
      const { videoBase64, mimeType } = await runComfyUiVideoWorkflow({
        baseUrl,
        workflowKey: selectedWorkflowKey,
        prompt: prompt || '',
        firstFrameImageUrl: imageUrl,
        referenceImageUrls: normalizeComfyUiReferenceImageUrls(options.referenceImageUrls),
        lastFrameImageUrl: typeof options.lastFrameImageUrl === 'string' ? options.lastFrameImageUrl : undefined,
        width: targetSize?.w,
        height: targetSize?.h,
        durationSeconds: typeof options.duration === 'number' ? options.duration : undefined,
        fps: typeof options.fps === 'number' ? options.fps : undefined,
        llmApi,
      })

      return {
        success: true,
        videoUrl: `data:${mimeType};base64,${videoBase64}`,
      }
    } catch (error) {
      return {
        success: false,
        error: normalizeComfyUiProviderError(error).slice(0, 500),
      }
    }
  }
}
