import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { FAL_LYRIA_3_PRO_MODEL_ID } from '@/lib/ai-providers/fal/models'
import { submitFalQueueRequest } from '@/lib/ai-providers/fal/submission'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function submitFalMusic(endpoint: string, apiKey: string, payload: Record<string, unknown>): Promise<string> {
  return await submitFalQueueRequest({
    endpoint,
    apiKey,
    payload,
    scope: `fal:music:submit:${endpoint}`,
  })
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
