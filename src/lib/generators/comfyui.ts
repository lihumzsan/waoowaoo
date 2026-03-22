import { getProviderConfig } from '@/lib/api-config'
import { logWarn as _ulogWarn } from '@/lib/logging/core'
import { runComfyUiTxt2Img } from '@/lib/providers/comfyui/client'
import { COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID } from '@/lib/providers/comfyui/workflow-registry'
import { BaseImageGenerator, type GenerateResult, type ImageGenerateParams } from './base'

/** 常见分辨率映射（与 Ark 等类似，用于 aspectRatio） */
const ASPECT_TO_SIZE: Record<string, { w: number; h: number }> = {
  '1:1': { w: 512, h: 512 },
  '16:9': { w: 768, h: 432 },
  '9:16': { w: 432, h: 768 },
  '3:4': { w: 512, h: 682 },
  '4:3': { w: 682, h: 512 },
  '3:2': { w: 768, h: 512 },
  '2:3': { w: 512, h: 768 },
}

function parseWxH(size: string | undefined): { w: number; h: number } | null {
  if (!size || typeof size !== 'string') return null
  const m = size.trim().match(/^(\d+)\s*x\s*(\d+)$/i)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64 || w > 4096 || h > 4096) return null
  return { w, h }
}

export class ComfyUIImageGenerator extends BaseImageGenerator {
  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const { userId, prompt, referenceImages = [], options = {} } = params

    if (referenceImages.length > 0) {
      _ulogWarn(
        `[ComfyUI] reference images provided (${referenceImages.length}) but current adapter only supports text-to-image; fallback to txt2img`,
      )
    }

    const providerId = typeof options.provider === 'string' ? options.provider : 'comfyui'
    const { baseUrl } = await getProviderConfig(userId, providerId)
    if (!baseUrl) {
      return { success: false, error: 'COMFYUI_BASE_URL_MISSING: 请在 API 配置中填写 ComfyUI 服务地址（含实际端口，如 http://127.0.0.1:8878）' }
    }

    const workflowKey = typeof options.modelId === 'string' && options.modelId.trim()
      ? options.modelId.trim()
      : COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID

    let width = 512
    let height = 512
    const direct = parseWxH(options.size as string | undefined)
    if (direct) {
      width = direct.w
      height = direct.h
    } else if (typeof options.aspectRatio === 'string') {
      const mapped = ASPECT_TO_SIZE[options.aspectRatio.trim()]
      if (mapped) {
        width = mapped.w
        height = mapped.h
      }
    }

    try {
      const { imageBase64, mimeType } = await runComfyUiTxt2Img({
        baseUrl,
        workflowKey,
        prompt,
        width,
        height,
      })
      const dataUrl = `data:${mimeType};base64,${imageBase64}`
      return {
        success: true,
        imageBase64,
        imageUrl: dataUrl,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { success: false, error: message.slice(0, 500) }
    }
  }
}
