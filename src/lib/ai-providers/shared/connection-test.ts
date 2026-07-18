import { generateText, type LanguageModel } from 'ai'
import { composeModelKey } from '@/lib/ai-registry/selection'
import { DEFAULT_REASONING_EFFORT } from '@/lib/ai-registry/reasoning-effort'
import type { AiLlmProtocol } from '@/lib/ai-registry/types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import type {
  AiProviderConnectionTester,
  AiProviderConnectionTestStep,
  AiProviderLanguageModelContext,
} from '@/lib/ai-providers/runtime-types'

export function connectionTestErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return 'Network error - check your internet connection'
    }
    if (error.message.includes('Connection error')) return 'Network error - temporary connection failure, please retry'
    if (error.message.includes('401')) return 'Authentication failed - check API Key'
    if (error.message.includes('403')) return 'Access denied - check API Key permissions'
    if (error.message.includes('timeout') || error.name === 'TimeoutError') return 'Request timed out'
    return error.message.slice(0, 200)
  }
  return String(error).slice(0, 200)
}

export function classifyConnectionProbeFailure(status: number): string {
  if (status === 401 || status === 403) return `Authentication failed (${status})`
  if (status === 429) return `Rate limited (${status})`
  return `Provider error (${status})`
}

function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/models`
}

export function createAiSdkConnectionTester(defaults: {
  providerKey: string
  displayName: string
  defaultBaseUrl: string
  defaultTestModel: string
  protocol: AiLlmProtocol
  createLanguageModel: (input: AiProviderLanguageModelContext) => LanguageModel
}): AiProviderConnectionTester {
  const createModel = (input: { apiKey: string; baseUrl?: string; model?: string }) => {
    const modelId = input.model || defaults.defaultTestModel
    const modelKey = composeModelKey(defaults.providerKey, modelId)
    return defaults.createLanguageModel({
      providerKey: defaults.providerKey,
      selection: {
        provider: defaults.providerKey,
        modelId,
        modelKey,
      },
      providerConfig: {
        id: defaults.providerKey,
        name: defaults.displayName,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl || defaults.defaultBaseUrl,
      },
      protocol: defaults.protocol,
      executionMode: 'sync',
      reasoning: false,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      temperature: 0,
    })
  }

  const probeText = async (input: { apiKey: string; baseUrl?: string; model?: string }) => {
    const modelId = input.model || defaults.defaultTestModel
    const response = await generateText({
      model: createModel(input),
      prompt: '1+1=? Reply with only the number.',
      maxOutputTokens: 8,
      temperature: 0,
      maxRetries: 0,
    })
    return { model: response.response.modelId || modelId, answer: response.text.trim() }
  }

  return {
    testLlm: probeText,
    diagnose: async (input) => {
      const model = input.llmModel || defaults.defaultTestModel
      const baseUrl = input.baseUrl || defaults.defaultBaseUrl
      const steps: AiProviderConnectionTestStep[] = []
      try {
        const response = await fetchWithProviderProxy(buildModelsUrl(baseUrl), {
          method: 'GET',
          headers: { Authorization: `Bearer ${input.apiKey}` },
        })
        if (!response.ok) {
          steps.push({
            name: 'models',
            status: 'fail',
            message: connectionTestErrorMessage(new Error(String(response.status))),
          })
          steps.push({ name: 'textGen', status: 'skip', message: 'Skipped because models probe failed', model })
          return { success: false, steps }
        }
        steps.push({ name: 'models', status: 'pass', message: `${defaults.displayName} models endpoint ok` })
      } catch (error) {
        steps.push({ name: 'models', status: 'fail', message: connectionTestErrorMessage(error) })
        steps.push({ name: 'textGen', status: 'skip', message: 'Skipped because models probe failed', model })
        return { success: false, steps }
      }

      try {
        const response = await probeText({ apiKey: input.apiKey, baseUrl, model })
        steps.push({
          name: 'textGen',
          status: response.answer ? 'pass' : 'fail',
          message: response.answer ? 'Text generation ok' : 'Text generation returned empty response',
          model: response.model,
        })
      } catch (error) {
        steps.push({ name: 'textGen', status: 'fail', message: connectionTestErrorMessage(error), model })
      }
      return { success: steps.every((step) => step.status !== 'fail'), steps }
    },
  }
}
