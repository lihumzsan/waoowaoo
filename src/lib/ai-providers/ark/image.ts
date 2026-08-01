import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { AiProviderImageExecutionContext } from '@/lib/ai-providers/runtime-types'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { fetchWithRetry, RETRY_POLICY } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { AppError } from '@/lib/errors/app-error'

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

const DEFAULT_TIMEOUT_MS = 60 * 1000

export interface ArkImageGenerationRequest {
  model: string
  prompt: string
  response_format?: 'url' | 'b64_json'
  size?: string
  aspect_ratio?: string
  watermark?: boolean
  image?: string[]
  sequential_image_generation?: 'enabled' | 'disabled'
  stream?: boolean
}

export interface ArkImageGenerationResponse {
  data: Array<{ url?: string; b64_json?: string }>
}

export async function arkImageGeneration(
  request: ArkImageGenerationRequest,
  options?: { apiKey: string; timeoutMs?: number; logPrefix?: string },
): Promise<ArkImageGenerationResponse> {
  if (!options?.apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'ark' })

  const { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, logPrefix = '[Ark Image]' } = options
  const url = `${ARK_BASE_URL}/images/generations`

  _ulogInfo(`${logPrefix} 开始图片生成请求, 模型: ${request.model}`)
  _ulogInfo(
    `${logPrefix} 请求参数:`,
    JSON.stringify(
      {
        model: request.model,
        size: request.size,
        aspect_ratio: request.aspect_ratio,
        watermark: request.watermark,
        imageCount: request.image?.length || 0,
        promptLength: request.prompt?.length || 0,
      },
      null,
      2,
    ),
  )

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request),
    policy: RETRY_POLICY.providerSubmit,
    timeoutMs,
    scope: 'ark:image',
    fetchFn: fetchWithProviderProxy,
  })

  const data = (await response.json()) as ArkImageGenerationResponse
  _ulogInfo(`${logPrefix} 图片生成成功`)
  return data
}

export const ARK_API_TIMEOUT_MS = DEFAULT_TIMEOUT_MS

type ArkImageOptions = NonNullable<AiProviderImageExecutionContext['options']>

// 4K 分辨率映射表（Seedream 4.x，上限 4096x4096 ≈ 16.7M 像素）
const SIZE_MAP_4K: Record<string, string> = {
  '1:1': '4096x4096',
  '16:9': '5456x3072',
  '9:16': '3072x5456',
  '4:3': '4728x3544',
  '3:4': '3544x4728',
  '3:2': '5016x3344',
  '2:3': '3344x5016',
  '21:9': '6256x2680',
  '9:21': '2680x6256',
}

// 3K 分辨率映射表（Seedream 5.0，上限 ≈ 10,404,496 像素）
const SIZE_MAP_3K: Record<string, string> = {
  '1:1': '3072x3072',
  '16:9': '4096x2304',
  '9:16': '2304x4096',
  '4:3': '3648x2736',
  '3:4': '2736x3648',
  '3:2': '3888x2592',
  '2:3': '2592x3888',
  '21:9': '4704x2016',
  '9:21': '2016x4704',
}

function isSeedream5Model(modelId: string): boolean {
  return modelId.includes('seedream-5')
}

function getSizeMapForModel(modelId: string): Record<string, string> {
  return isSeedream5Model(modelId) ? SIZE_MAP_3K : SIZE_MAP_4K
}

function assertAllowedArkImageOptions(options: ArkImageOptions) {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'aspectRatio',
    'size',
    'resolution',
    'referenceImages',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`ARK_IMAGE_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

export async function executeArkImageGeneration(input: AiProviderImageExecutionContext) {
  const options: ArkImageOptions = input.options ?? {}
  assertAllowedArkImageOptions(options)

  const { apiKey } = await getProviderConfig(input.userId, input.selection.provider)
  const modelId = requireSelectedModelId(input.selection, 'ark:image')

  const resolution = options.resolution
  if (resolution !== undefined && resolution !== '4K' && resolution !== '3K') {
    throw new Error(`ARK_IMAGE_OPTION_VALUE_UNSUPPORTED: resolution=${resolution}`)
  }

  const directSize = options.size
  const sizeMap = getSizeMapForModel(modelId)
  const aspectRatio = options.aspectRatio

  const size = directSize
    ? directSize
    : (() => {
      if (!aspectRatio) {
        throw new Error('ARK_IMAGE_OPTION_REQUIRED: aspectRatio or size must be provided')
      }
      const mapped = sizeMap[aspectRatio]
      if (!mapped) {
        throw new Error(`ARK_IMAGE_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
      }
      return mapped
    })()

  const referenceImages = options.referenceImages ?? []

  const arkData = await arkImageGeneration({
    model: modelId,
    prompt: input.prompt,
    sequential_image_generation: 'disabled',
    response_format: 'url',
    stream: false,
    watermark: false,
    ...(size ? { size } : {}),
    ...(referenceImages.length > 0 ? { image: referenceImages } : {}),
  }, { apiKey, logPrefix: '[ARK Image]' })

  const imageUrls = Array.isArray(arkData.data)
    ? arkData.data
      .map((item) => (typeof item?.url === 'string' ? item.url.trim() : ''))
      .filter((item) => item.length > 0)
    : []
  const imageUrl = imageUrls[0]

  if (!imageUrl) {
    throw new Error('ARK_IMAGE_EMPTY_RESPONSE: no image url returned')
  }

  return {
    success: true,
    imageUrl,
    ...(imageUrls.length > 1 ? { imageUrls } : {}),
  }
}
