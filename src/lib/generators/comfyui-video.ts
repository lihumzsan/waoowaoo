import { getProviderConfig } from '@/lib/api-config'
import { runComfyUiVideoWorkflow } from '@/lib/providers/comfyui/client'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'

/**
 * 本地 ComfyUI 视频：由 workflows/<workflowKey>.json 定义整图；可选 .meta.json 注入 prompt。
 * 当前不注入产品侧首帧 imageUrl，请在工作流内自行处理输入。
 */
export class ComfyUIVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, prompt, options = {} } = params

    const providerId = typeof options.provider === 'string' ? options.provider : 'comfyui'
    const { baseUrl } = await getProviderConfig(userId, providerId)
    if (!baseUrl) {
      return {
        success: false,
        error: 'COMFYUI_BASE_URL_MISSING: 请在 API 配置中填写 ComfyUI 服务地址',
      }
    }

    const workflowKey =
      typeof options.modelId === 'string' && options.modelId.trim()
        ? options.modelId.trim()
        : ''

    if (!workflowKey) {
      return {
        success: false,
        error: 'COMFYUI_VIDEO_WORKFLOW_KEY_MISSING: 请在视频模型中配置工作流标识（与 workflows 目录下 JSON 文件名一致）',
      }
    }

    try {
      const { videoBase64, mimeType } = await runComfyUiVideoWorkflow({
        baseUrl,
        workflowKey,
        prompt: prompt || '',
      })
      const dataUrl = `data:${mimeType};base64,${videoBase64}`
      return {
        success: true,
        videoUrl: dataUrl,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { success: false, error: message.slice(0, 500) }
    }
  }
}
