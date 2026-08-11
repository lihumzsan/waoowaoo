import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from 'ai'
import type { AiLlmExecutionResult } from '@/lib/ai-registry/types'
import type {
  AiProviderLanguageModelContext,
  AiProviderLanguageModelValidationContext,
} from '@/lib/ai-providers/runtime-types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { AppError } from '@/lib/errors/app-error'
import {
  assertGoogleSubmissionResponse,
  googleSafetyTerminalError,
} from './submission'

const googleLanguageModelFetch: typeof fetch = async (input, init) => {
  const response = await fetchWithProviderProxy(input, init)
  await assertGoogleSubmissionResponse(response)
  return response
}

export function createGoogleSdkLanguageModel(input: AiProviderLanguageModelContext): LanguageModel {
  if (input.protocol !== 'google-generative-ai') {
    throw new Error(`LLM_PROTOCOL_PROVIDER_MISMATCH:google:${input.protocol}`)
  }
  const google = createGoogleGenerativeAI({
    apiKey: input.providerConfig.apiKey,
    ...(input.providerConfig.baseUrl ? { baseURL: input.providerConfig.baseUrl } : {}),
    name: input.providerKey,
    fetch: googleLanguageModelFetch,
  })
  const providerOptions = input.reasoning && input.selection.modelId.startsWith('gemini-3')
    ? {
      google: {
        thinkingConfig: {
          thinkingLevel: input.reasoningEffort,
          includeThoughts: true,
        },
      },
    }
    : undefined
  const model = google.chat(input.selection.modelId)
  if (!providerOptions) return model
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions },
    }),
  })
}

export function validateGoogleLanguageModelResult(
  result: AiLlmExecutionResult,
  context: AiProviderLanguageModelValidationContext,
): void {
  if (result.text.trim()) return
  if (result.termination.kind === 'safety') {
    const reason = result.termination.rawReason || 'SAFETY'
    throw googleSafetyTerminalError(reason, result)
  }
  if (context.executionMode === 'vision') return
  throw new AppError('EMPTY_RESPONSE', 'Google Gemini returned an empty text response, please retry', {
    provider: 'google',
    details: { rawReason: result.termination.rawReason },
    cause: result,
  })
}
