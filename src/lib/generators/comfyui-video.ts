import { getProviderConfig } from '@/lib/api-config'
import { normalizeVideoModelKey } from '@/lib/novel-promotion/video-model-defaults'
import { isComfyUiWorkflowLlmApiRequired, runComfyUiVideoWorkflow } from '@/lib/providers/comfyui/client'
import { isRemovedLegacyLtx23WorkflowKey } from '@/lib/providers/comfyui/ltx23-legacy'
import { resolveComfyUiLlmApiConfig } from '@/lib/providers/comfyui/llm-api-config'
import { resolveLtx23WorkflowRoute } from '@/lib/providers/comfyui/ltx23-workflow-router'
import {
  COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID,
  isSeedance2BerniniWorkflowKey,
  resolveSeedance2BerniniWorkflowKey,
} from '@/lib/providers/comfyui/seedance2-bernini-workflow'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'

const ASPECT_TO_SIZE: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1280, h: 736 },
  '9:16': { w: 736, h: 1280 },
  '3:4': { w: 960, h: 1280 },
  '4:3': { w: 1280, h: 960 },
  '3:2': { w: 1216, h: 832 },
  '2:3': { w: 832, h: 1216 },
}

const BERNINI_LANDSCAPE_16_9_SIZE = { w: 848, h: 464 } as const

const COMFYUI_VIDEO_DIMENSION_ALIGNMENT = 32
const BERNINI_VIDEO_DIMENSION_ALIGNMENT = 16

function alignComfyUiVideoDimension(value: number, alignment = COMFYUI_VIDEO_DIMENSION_ALIGNMENT): number {
  return Math.max(
    64,
    Math.min(4096, Math.round(value / alignment) * alignment),
  )
}

function normalizeComfyUiVideoSize(size: { w: number; h: number } | null): { w: number; h: number } | null {
  if (!size) return null
  return {
    w: alignComfyUiVideoDimension(size.w),
    h: alignComfyUiVideoDimension(size.h),
  }
}

function normalizeBernini480pVideoSize(size: { w: number; h: number } | null): { w: number; h: number } {
  const source = size || { w: 480, h: 848 }
  const ratio = source.w > 0 && source.h > 0 ? source.w / source.h : 480 / 848
  const shortSide = 480
  const maxLongSide = 848

  if (ratio >= 1) {
    return {
      w: Math.min(maxLongSide, alignComfyUiVideoDimension(shortSide * ratio, BERNINI_VIDEO_DIMENSION_ALIGNMENT)),
      h: shortSide,
    }
  }

  return {
    w: shortSide,
    h: Math.min(maxLongSide, alignComfyUiVideoDimension(shortSide / ratio, BERNINI_VIDEO_DIMENSION_ALIGNMENT)),
  }
}

function resolveBernini480pVideoSize(
  directSize: { w: number; h: number } | null,
  aspectRatio: string | undefined,
  aspectSize: { w: number; h: number } | undefined,
): { w: number; h: number } {
  if (directSize) {
    if (directSize.w === BERNINI_LANDSCAPE_16_9_SIZE.w && directSize.h === BERNINI_LANDSCAPE_16_9_SIZE.h) {
      return { ...BERNINI_LANDSCAPE_16_9_SIZE }
    }
    return normalizeBernini480pVideoSize(directSize)
  }

  if (aspectRatio === '16:9') {
    return { ...BERNINI_LANDSCAPE_16_9_SIZE }
  }

  return normalizeBernini480pVideoSize(aspectSize || null)
}

function normalizeComfyUiReferenceImageUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const urls = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return urls.length > 0 ? urls : undefined
}

function normalizeComfyUiReferenceAudioUrls(value: unknown): string[] | undefined {
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

function normalizeComfyUiVideoWorkflowKey(rawWorkflowKey: string): string {
  const normalizedModelKey = normalizeVideoModelKey(rawWorkflowKey)
  return normalizedModelKey.startsWith('comfyui::')
    ? normalizedModelKey.slice('comfyui::'.length)
    : normalizedModelKey
}

type ComfyUiVideoWorkflowSelection = {
  workflowKey: string
  durationSeconds?: number
}

function resolveComfyUiVideoWorkflowSelection(
  workflowKey: string,
  prompt: string,
  options?: {
    generationMode?: unknown
    multiShotRange?: unknown
    duration?: unknown
    ltx23WorkflowSelection?: unknown
    hasReferenceAudio?: boolean
  },
): ComfyUiVideoWorkflowSelection {
  const trimmedWorkflowKey = workflowKey.trim()
  const route = resolveLtx23WorkflowRoute({
    modelKey: trimmedWorkflowKey,
    selectionMode: options?.ltx23WorkflowSelection,
    generationMode: options?.generationMode,
    requestedDurationSeconds: typeof options?.duration === 'number' ? options.duration : null,
    hasReferenceAudio: options?.hasReferenceAudio === true,
    panel: { videoPrompt: prompt },
  })
  const selectedWorkflowKey = route?.selectedWorkflowKey ?? trimmedWorkflowKey
  return {
    workflowKey: resolveSeedance2BerniniWorkflowKey({
      requestedWorkflowKey: selectedWorkflowKey,
      hasReferenceAudio: options?.hasReferenceAudio === true,
    }),
    ...(route ? { durationSeconds: route.durationSeconds } : {}),
  }
}

export function selectComfyUiVideoWorkflowKey(
  workflowKey: string,
  prompt: string,
  options?: Parameters<typeof resolveComfyUiVideoWorkflowSelection>[2],
): string {
  return resolveComfyUiVideoWorkflowSelection(workflowKey, prompt, options).workflowKey
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
    const workflowKey = typeof options.modelId === 'string' && options.modelId.trim()
      ? normalizeComfyUiVideoWorkflowKey(options.modelId.trim())
      : COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID
    if (isRemovedLegacyLtx23WorkflowKey(workflowKey)) {
      return {
        success: false,
        error: `LEGACY_LTX23_WORKFLOW_REMOVED: ${workflowKey}`,
      }
    }

    const providerId = typeof options.provider === 'string' ? options.provider : 'comfyui'
    const { baseUrl } = await getProviderConfig(userId, providerId)

    if (!baseUrl) {
      return {
        success: false,
        error: 'COMFYUI_BASE_URL_MISSING: configure your ComfyUI Base URL first',
      }
    }

    const referenceAudioUrls = normalizeComfyUiReferenceAudioUrls(options.referenceAudioUrls)
    const selectedWorkflow = resolveComfyUiVideoWorkflowSelection(workflowKey, prompt || '', {
      generationMode: options.generationMode,
      multiShotRange: options.multiShotRange,
      duration: options.duration,
      ltx23WorkflowSelection: options.ltx23WorkflowSelection,
      hasReferenceAudio: !!referenceAudioUrls?.length,
    })
    const selectedWorkflowKey = selectedWorkflow.workflowKey
    const directSize = parseWxH(typeof options.size === 'string' ? options.size : undefined)
    const requestedAspectRatio = typeof options.aspectRatio === 'string'
      ? options.aspectRatio.trim()
      : undefined
    const aspectSize = requestedAspectRatio
      ? ASPECT_TO_SIZE[requestedAspectRatio]
      : undefined
    const targetSize = isSeedance2BerniniWorkflowKey(selectedWorkflowKey)
      ? resolveBernini480pVideoSize(directSize, requestedAspectRatio, aspectSize)
      : normalizeComfyUiVideoSize(directSize || aspectSize || null)

    try {
      const llmApi = isComfyUiWorkflowLlmApiRequired(selectedWorkflowKey)
        ? await resolveComfyUiLlmApiConfig({
            userId,
            analysisModel: typeof options.analysisModel === 'string' ? options.analysisModel : null,
          })
        : undefined
      const { videoUrl, mimeType, contentLength } = await runComfyUiVideoWorkflow({
        baseUrl,
        workflowKey: selectedWorkflowKey,
        prompt: prompt || '',
        firstFrameImageUrl: imageUrl,
        referenceImageUrls: normalizeComfyUiReferenceImageUrls(options.referenceImageUrls),
        referenceAudioUrls,
        lastFrameImageUrl: typeof options.lastFrameImageUrl === 'string' ? options.lastFrameImageUrl : undefined,
        width: targetSize?.w,
        height: targetSize?.h,
        durationSeconds: selectedWorkflow.durationSeconds ?? (typeof options.duration === 'number' ? options.duration : undefined),
        fps: typeof options.fps === 'number' ? options.fps : undefined,
        motionStrength: typeof options.motionStrength === 'number' ? options.motionStrength : undefined,
        llmApi,
      })

      return {
        success: true,
        videoUrl,
        videoStream: {
          mimeType,
          ...(contentLength === undefined ? {} : { contentLength }),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: normalizeComfyUiProviderError(error).slice(0, 500),
      }
    }
  }
}
