import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderVoiceExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import {
  FAL_QWEN_3_TTS_LANGUAGE_OPTIONS,
  FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
} from '@/lib/ai-providers/fal/models'
import { submitFalTask } from '@/lib/ai-providers/fal/queue'

type FalVoiceLanguage = typeof FAL_QWEN_3_TTS_LANGUAGE_OPTIONS[number]

function requireText(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function resolveLanguage(value: unknown): FalVoiceLanguage {
  if (typeof value !== 'string' || !FAL_QWEN_3_TTS_LANGUAGE_OPTIONS.includes(value as FalVoiceLanguage)) {
    throw new Error(`FAL_VOICE_LANGUAGE_UNSUPPORTED:${String(value)}`)
  }
  return value as FalVoiceLanguage
}

export async function executeFalVoiceGeneration(input: AiProviderVoiceExecutionContext): Promise<GenerateResult> {
  const { apiKey } = await getProviderConfig(input.userId, input.selection.provider)
  const modelId = requireSelectedModelId(input.selection, 'fal:voice')
  if (modelId !== FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID) {
    throw new Error(`FAL_VOICE_MODEL_UNSUPPORTED:${modelId}`)
  }
  const description = requireText(input.description, 'FAL_VOICE_DESCRIPTION_REQUIRED')
  const text = requireText(input.text, 'FAL_VOICE_TEXT_REQUIRED')
  const language = resolveLanguage(input.options?.language ?? 'Auto')
  const requestId = await submitFalTask(modelId, {
    text,
    prompt: description,
    language,
  }, apiKey)
  return {
    success: true,
    async: true,
    requestId,
    endpoint: modelId,
    externalId: `FAL:VOICE:${modelId}:${requestId}`,
  }
}
