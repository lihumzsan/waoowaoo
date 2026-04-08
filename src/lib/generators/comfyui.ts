import { getProviderConfig } from '@/lib/api-config'
import { runComfyUiImageWorkflow } from '@/lib/providers/comfyui/client'
import { COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID } from '@/lib/providers/comfyui/workflow-registry'
import { BaseImageGenerator, type GenerateResult, type ImageGenerateParams } from './base'

const ASPECT_TO_SIZE: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1280, h: 720 },
  '9:16': { w: 720, h: 1280 },
  '3:4': { w: 960, h: 1280 },
  '4:3': { w: 1280, h: 960 },
  '3:2': { w: 1216, h: 832 },
  '2:3': { w: 832, h: 1216 },
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

export class ComfyUIImageGenerator extends BaseImageGenerator {
  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const { userId, prompt, referenceImages = [], options = {} } = params
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
      : COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID

    let width = 1024
    let height = 1024
    const directSize = parseWxH(typeof options.size === 'string' ? options.size : undefined)
    if (directSize) {
      width = directSize.w
      height = directSize.h
    } else if (typeof options.aspectRatio === 'string') {
      const mapped = ASPECT_TO_SIZE[options.aspectRatio.trim()]
      if (mapped) {
        width = mapped.w
        height = mapped.h
      }
    }

    try {
      const { imageBase64, mimeType } = await runComfyUiImageWorkflow({
        baseUrl,
        workflowKey,
        prompt,
        negativePrompt: typeof options.negativePrompt === 'string' ? options.negativePrompt : undefined,
        width,
        height,
        referenceImages,
      })

      return {
        success: true,
        imageBase64,
        imageUrl: `data:${mimeType};base64,${imageBase64}`,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      }
    }
  }
}
