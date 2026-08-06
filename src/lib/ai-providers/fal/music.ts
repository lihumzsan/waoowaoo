import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { buildFalQueueUrl } from '@/lib/ai-providers/fal/base-url'
import { FAL_LYRIA_3_PRO_MODEL_ID } from '@/lib/ai-providers/fal/models'
import { RETRY_POLICY, fetchWithRetry } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

interface FalMusicSubmitResponse {
  request_id?: unknown
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function submitFalMusic(endpoint: string, apiKey: string, payload: Record<string, unknown>): Promise<string> {
  const response = await fetchWithRetry(buildFalQueueUrl(endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(payload),
    policy: RETRY_POLICY.providerSubmit,
    cache: 'no-store',
    scope: `fal:music:submit:${endpoint}`,
    fetchFn: fetchWithProviderProxy,
  })

  const data = await response.json() as FalMusicSubmitResponse
  const requestId = readTrimmedString(data.request_id)
  if (!requestId) throw new Error('FAL_MUSIC_REQUEST_ID_MISSING')
  return requestId
}

export async function executeFalMusicGeneration(input: AiProviderMusicExecutionContext): Promise<GenerateResult> {
  const options = input.options ?? {}
  const { apiKey } = await getProviderConfig(input.userId, input.selection.provider)
  const modelId = requireSelectedModelId(input.selection, 'fal:music')
  if (modelId !== FAL_LYRIA_3_PRO_MODEL_ID) {
    throw new Error(`FAL_MUSIC_MODEL_UNSUPPORTED:${modelId}`)
  }

  const prompt = input.prompt
  if (!prompt.trim()) throw new Error('FAL_MUSIC_PROMPT_REQUIRED')
  const negativePrompt = readTrimmedString(options.negativePrompt)

  const requestId = await submitFalMusic(modelId, apiKey, {
    prompt,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
  })
  return {
    success: true,
    async: true,
    requestId,
    endpoint: modelId,
    externalId: `FAL:MUSIC:${modelId}:${requestId}`,
  }
}
