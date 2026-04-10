import { getProviderConfig } from '@/lib/api-config'
import { runComfyUiVideoWorkflow } from '@/lib/providers/comfyui/client'
import { COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID } from '@/lib/providers/comfyui/workflow-registry'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'

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

    try {
      const { videoBase64, mimeType } = await runComfyUiVideoWorkflow({
        baseUrl,
        workflowKey,
        prompt: prompt || '',
        firstFrameImageUrl: imageUrl,
        lastFrameImageUrl: typeof options.lastFrameImageUrl === 'string' ? options.lastFrameImageUrl : undefined,
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
