import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { AiLlmExecutionResult } from '@/lib/ai-registry/types'
import type {
  AiProviderLanguageModelContext,
  AiProviderLanguageModelValidationContext,
} from '@/lib/ai-providers/runtime-types'
import { buildOpenRouterPromptCacheRequest } from '@/lib/ai-providers/openrouter/prompt-cache'
import { createScopedLogger } from '@/lib/logging/core'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { AppError } from '@/lib/errors/app-error'

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  const bodyText = typeof init?.body === 'string'
    ? init.body
    : typeof Request !== 'undefined' && input instanceof Request
      ? await input.clone().text()
      : ''
  if (!bodyText) throw new Error('OPENROUTER_LANGUAGE_MODEL_REQUEST_BODY_MISSING')
  const body = asRecord(JSON.parse(bodyText) as unknown)
  if (!body) throw new Error('OPENROUTER_LANGUAGE_MODEL_REQUEST_BODY_INVALID')
  return body
}

function createOpenRouterLoggingFetch(input: AiProviderLanguageModelContext): typeof fetch {
  return async (requestInput, requestInit) => {
    const startedAt = Date.now()
    const body = await readRequestBody(requestInput, requestInit)
    const promptCacheRequest = input.messages
      ? buildOpenRouterPromptCacheRequest({
        modelId: input.selection.modelId,
        messages: input.messages,
      })
      : null
    const nextBody = JSON.stringify({
      ...body,
      ...(promptCacheRequest ? { messages: promptCacheRequest.messages } : {}),
      ...(!body.cache_control && promptCacheRequest?.cacheControl
        ? { cache_control: promptCacheRequest.cacheControl }
        : {}),
    })
    const preparedInput = typeof Request !== 'undefined' && requestInput instanceof Request
      ? new Request(requestInput, { body: nextBody })
      : requestInput
    const preparedInit = typeof requestInit?.body === 'string'
      ? { ...requestInit, body: nextBody }
      : requestInit
    const response = await fetchWithProviderProxy(preparedInput, preparedInit)
    void response.clone().text()
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
            openRouterSessionId: input.openRouterSessionId ?? null,
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
            openRouterSessionId: input.openRouterSessionId ?? null,
          },
          error: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
        })
      })
    return response
  }
}

export function createOpenRouterLanguageModel(input: AiProviderLanguageModelContext) {
  if (input.protocol !== 'openrouter-chat') {
    throw new Error(`LLM_PROTOCOL_PROVIDER_MISMATCH:openrouter:${input.protocol}`)
  }
  const baseURL = input.providerConfig.baseUrl?.trim()
  if (!baseURL) throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (language-model)')
  const openRouter = createOpenRouter({
    baseURL,
    apiKey: input.providerConfig.apiKey,
    compatibility: 'strict',
    fetch: createOpenRouterLoggingFetch(input),
    ...(input.openRouterSessionId
      ? { headers: { 'x-session-id': input.openRouterSessionId } }
      : {}),
  })
  const model = openRouter.chat(input.selection.modelId, {
    usage: { include: true },
    ...(input.reasoning
      ? { extraBody: { reasoning: { effort: input.reasoningEffort } } }
      : {}),
  })
  return model
}

export function validateOpenRouterLanguageModelResult(
  result: AiLlmExecutionResult,
  context: AiProviderLanguageModelValidationContext,
): void {
  if (context.executionMode === 'vision') return
  if (result.termination.kind === 'token_limit') {
    throw new AppError('MODEL_OUTPUT_TRUNCATED', 'OpenRouter output reached the token limit', {
      provider: 'openrouter',
      details: {
        rawReason: result.termination.rawReason,
        textChars: result.text.length,
        reasoningChars: result.reasoning.length,
      },
    })
  }
  if (context.executionMode === 'stream' && result.termination.kind === 'safety') {
    throw new AppError('SENSITIVE_CONTENT', 'OpenRouter blocked the response for safety reasons', {
      provider: 'openrouter',
      details: { rawReason: result.termination.rawReason },
    })
  }
  if (context.executionMode === 'stream' && result.termination.kind === 'unknown') {
    throw new AppError('EXTERNAL_ERROR', 'OpenRouter stream ended without a recognized final status', {
      provider: 'openrouter',
      details: { rawReason: result.termination.rawReason },
    })
  }
  if (!result.text.trim()) {
    throw new AppError('EMPTY_RESPONSE', 'OpenRouter returned no response body', {
      provider: 'openrouter',
      details: {
        rawReason: result.termination.rawReason,
        textChars: 0,
        reasoningChars: result.reasoning.length,
      },
    })
  }
}
