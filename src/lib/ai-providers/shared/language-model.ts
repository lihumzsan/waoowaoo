import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import { createScopedLogger } from '@/lib/logging/core'

const openRouterLanguageModelLogger = createScopedLogger({
  module: 'ai-provider.openrouter.language-model',
})

function headersToRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  headers.forEach((value, key) => {
    output[key] = value
  })
  return output
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function parseResponseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function createOpenRouterLoggingFetch(input: {
  sessionId?: string
}): typeof fetch {
  return async (requestInput, requestInit) => {
    const startedAt = Date.now()
    const response = await fetch(requestInput, requestInit)
    const responseClone = response.clone()
    void responseClone.text()
      .then((bodyText) => {
        openRouterLanguageModelLogger.info({
          action: 'openrouter.language_model.response',
          message: 'OpenRouter language model response',
          provider: 'openrouter',
          durationMs: Date.now() - startedAt,
          details: {
            url: requestUrl(requestInput),
            status: response.status,
            statusText: response.statusText,
            headers: headersToRecord(response.headers),
            openRouterSessionId: input.sessionId ?? null,
            body: parseResponseBody(bodyText),
          },
        })
      })
      .catch((error: unknown) => {
        openRouterLanguageModelLogger.warn({
          action: 'openrouter.language_model.response_log_failed',
          message: 'Failed to record OpenRouter language model response',
          provider: 'openrouter',
          durationMs: Date.now() - startedAt,
          details: {
            url: requestUrl(requestInput),
            openRouterSessionId: input.sessionId ?? null,
          },
          error: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
        })
      })
    return response
  }
}

export function createOpenAiSdkLanguageModel(input: AiProviderLanguageModelContext): LanguageModel {
  const isOpenRouter = input.providerKey === 'openrouter'
  const openai = createOpenAI({
    apiKey: input.providerConfig.apiKey,
    ...(input.providerConfig.baseUrl ? { baseURL: input.providerConfig.baseUrl } : {}),
    name: input.providerKey,
    ...(isOpenRouter && input.openRouterSessionId
      ? { headers: { 'x-session-id': input.openRouterSessionId } }
      : {}),
    ...(isOpenRouter
      ? { fetch: createOpenRouterLoggingFetch({ sessionId: input.openRouterSessionId }) }
      : {}),
  })
  return openai.chat(input.selection.modelId)
}
