import { GoogleGenAI } from '@google/genai'
import { getInternalBaseUrl } from '@/lib/env'
import { normalizeGeminiImageSize } from '@/lib/ai-providers/shared/google-image-helpers'
import { asUnknownObject, getErrorMessage, type UnknownObject } from '@/lib/ai-providers/shared/helpers'
import { withProviderProxyDispatcher } from '@/lib/http/outbound-proxy'
import { GOOGLE_PROVIDER_PROXY_TARGET } from '@/lib/ai-providers/google/proxy-target'
import { getImageBase64Cached } from '@/lib/image-cache'
import { logInternal } from '@/lib/logging/semantic'
import { AppError } from '@/lib/errors/app-error'

type GeminiBatchClient = {
  batches: {
    create(args: { model: string; src: unknown[]; config: { displayName: string } }): Promise<unknown>
  }
}

type GeminiBatchContentPart = { inlineData: { mimeType: string; data: string } } | { text: string }

export async function submitGeminiBatch(
  apiKey: string,
  prompt: string,
  options?: { referenceImages?: string[]; aspectRatio?: string; resolution?: string },
): Promise<{ batchName: string }> {
  if (!apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'google' })

  try {
    const ai = new GoogleGenAI({ apiKey })
    const contentParts: GeminiBatchContentPart[] = []
    const referenceImages = options?.referenceImages || []
    for (let index = 0; index < Math.min(referenceImages.length, 14); index += 1) {
      const imageData = referenceImages[index]
      if (!imageData) continue

      if (imageData.startsWith('data:')) {
        const base64Start = imageData.indexOf(';base64,')
        if (base64Start !== -1) {
          contentParts.push({
            inlineData: {
              mimeType: imageData.substring(5, base64Start),
              data: imageData.substring(base64Start + 8),
            },
          })
        }
        continue
      }

      if (imageData.startsWith('http') || imageData.startsWith('/')) {
        try {
          const fullUrl = imageData.startsWith('/') ? `${getInternalBaseUrl()}${imageData}` : imageData
          const base64DataUrl = await getImageBase64Cached(fullUrl)
          const base64Start = base64DataUrl.indexOf(';base64,')
          if (base64Start !== -1) {
            contentParts.push({
              inlineData: {
                mimeType: base64DataUrl.substring(5, base64Start),
                data: base64DataUrl.substring(base64Start + 8),
              },
            })
          }
        } catch (error: unknown) {
          logInternal('GeminiBatch', 'WARN', `下载参考图片 ${index + 1} 失败`, {
            error: getErrorMessage(error),
          })
        }
        continue
      }

      contentParts.push({ inlineData: { mimeType: 'image/png', data: imageData } })
    }

    contentParts.push({ text: prompt })
    const imageConfig: UnknownObject = {}
    if (options?.aspectRatio) imageConfig.aspectRatio = options.aspectRatio
    const imageSize = normalizeGeminiImageSize(options?.resolution)
    if (imageSize) imageConfig.imageSize = imageSize
    const inlinedRequests = [{
      contents: [{ parts: contentParts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    }]

    const batchClient = ai as unknown as GeminiBatchClient
    const batchJob = await withProviderProxyDispatcher(
      GOOGLE_PROVIDER_PROXY_TARGET,
      async () => await batchClient.batches.create({
        model: 'gemini-3-pro-image-preview',
        src: inlinedRequests,
        config: { displayName: `image-gen-${Date.now()}` },
      }),
    )
    const batchRecord = asUnknownObject(batchJob)
    const batchName = batchRecord && typeof batchRecord.name === 'string' ? batchRecord.name : ''
    if (!batchName) throw new Error('GEMINI_BATCH_NAME_MISSING')
    logInternal('GeminiBatch', 'INFO', `✅ 任务已提交: ${batchName}`)
    return { batchName }
  } catch (error: unknown) {
    logInternal('GeminiBatch', 'ERROR', '提交异常', { error: getErrorMessage(error) })
    throw error
  }
}
