import { getProviderConfig, getProviderKey, resolveModelSelection } from '@/lib/api-config'
import { getUserModelConfig } from '@/lib/config-service'
import type { ComfyUiWorkflowLlmApiInject } from './workflow-registry'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function resolveComfyUiLlmApiConfig(params: {
  userId: string
  analysisModel?: string | null
}): Promise<ComfyUiWorkflowLlmApiInject> {
  const configuredModel = readTrimmedString(params.analysisModel)
    || readTrimmedString((await getUserModelConfig(params.userId)).analysisModel)
  if (!configuredModel) {
    throw new Error('COMFYUI_LLM_MODEL_NOT_CONFIGURED: configure analysisModel with an OpenRouter/OpenAI-compatible LLM')
  }

  const selection = await resolveModelSelection(params.userId, configuredModel, 'llm')
  const providerKey = getProviderKey(selection.provider).toLowerCase()
  if (providerKey !== 'openrouter' && providerKey !== 'openai-compatible') {
    throw new Error(`COMFYUI_LLM_MODEL_NOT_OPENROUTER: analysisModel must use an OpenRouter/OpenAI-compatible provider (${selection.modelKey})`)
  }

  const providerConfig = await getProviderConfig(params.userId, selection.provider)
  const baseUrl = readTrimmedString(providerConfig.baseUrl)
  const apiKey = readTrimmedString(providerConfig.apiKey)
  if (!baseUrl || !apiKey) {
    throw new Error(`COMFYUI_LLM_MODEL_NOT_CONFIGURED: missing OpenRouter baseUrl or apiKey for ${selection.provider}`)
  }

  return {
    baseUrl,
    apiKey,
    model: selection.modelId,
  }
}
