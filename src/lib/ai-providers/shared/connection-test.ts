import { generateText, type LanguageModel } from 'ai'
import { composeModelKey } from '@/lib/ai-registry/selection'
import { DEFAULT_REASONING_EFFORT } from '@/lib/ai-registry/reasoning-effort'
import type { AiLlmProtocol } from '@/lib/ai-registry/types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import type {
  AiProviderConnectionTester,
  AiProviderFailureAdapter,
  AiProviderConnectionTestMessageKey,
  AiProviderConnectionTestStep,
  AiProviderLanguageModelContext,
} from '@/lib/ai-providers/runtime-types'
import {
  captureProviderHttpFailure,
} from '@/lib/ai-providers/failure'

export function projectConnectionTestFailure(
  failureAdapter: AiProviderFailureAdapter,
  error: unknown,
): Pick<AiProviderConnectionTestStep, 'messageKey' | 'diagnostic'> {
  const normalized = failureAdapter.normalize({
    error,
    phase: 'connection',
  })
  const code = normalized.interpretation.code
  let messageKey: AiProviderConnectionTestMessageKey
  if (code === 'PROVIDER_AUTH_INVALID' || code === 'MODEL_NOT_OPEN') {
    messageKey = 'connectionTest.authInvalid'
  } else if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') {
    messageKey = 'connectionTest.rateLimited'
  } else if (code === 'GENERATION_TIMEOUT') {
    messageKey = 'connectionTest.timeout'
  } else if (code === 'NETWORK_ERROR') {
    messageKey = 'connectionTest.networkError'
  } else {
    messageKey = 'connectionTest.providerError'
  }
  return { messageKey, diagnostic: normalized.native.message }
}

function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/models`
}

export function createAiSdkConnectionTester(defaults: {
  providerKey: string
  failure: AiProviderFailureAdapter
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
      publicReasoningMode: 'none',
    })
  }

  const probeText = async (input: { apiKey: string; baseUrl?: string; model?: string }) => {
    const modelId = input.model || defaults.defaultTestModel
    const response = await generateText({
      model: createModel(input),
      prompt: '1+1=? Reply with only the number.',
      maxOutputTokens: 8,
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
          const failure = await captureProviderHttpFailure({
            response,
            provider: defaults.providerKey,
            phase: 'connection',
          })
          steps.push({
            name: 'models',
            status: 'fail',
            ...projectConnectionTestFailure(defaults.failure, failure),
          })
          steps.push({ name: 'textGen', status: 'skip', messageKey: 'connectionTest.skippedModelsFailure', model })
          return { success: false, steps }
        }
        steps.push({ name: 'models', status: 'pass', messageKey: 'connectionTest.modelsOk' })
      } catch (error) {
        steps.push({
          name: 'models',
          status: 'fail',
          ...projectConnectionTestFailure(defaults.failure, error),
        })
        steps.push({ name: 'textGen', status: 'skip', messageKey: 'connectionTest.skippedModelsFailure', model })
        return { success: false, steps }
      }

      try {
        const response = await probeText({ apiKey: input.apiKey, baseUrl, model })
        steps.push({
          name: 'textGen',
          status: response.answer ? 'pass' : 'fail',
          messageKey: response.answer ? 'connectionTest.textGenerationOk' : 'connectionTest.emptyResponse',
          model: response.model,
        })
      } catch (error) {
        steps.push({
          name: 'textGen',
          status: 'fail',
          model,
          ...projectConnectionTestFailure(defaults.failure, error),
        })
      }
      return { success: steps.every((step) => step.status !== 'fail'), steps }
    },
  }
}
