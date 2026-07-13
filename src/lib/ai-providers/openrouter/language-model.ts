import type { LanguageModel } from 'ai'
import type { AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import { buildOpenRouterPromptCacheRequest } from '@/lib/ai-providers/openrouter/prompt-cache'
import { createOpenAiSdkLanguageModel } from '@/lib/ai-providers/shared/language-model'
import type { ProviderChatMessage, ProviderChatMessageContent } from '@/lib/ai-providers/shared/llm-support'
import { createScopedLogger } from '@/lib/logging/core'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

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
    ? (value as Record<string, unknown>)
    : null
}

function parseRequestBody(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    return asRecord(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

function toProviderMessageContent(value: unknown): ProviderChatMessageContent | null {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null
  const parts = value.flatMap((item) => {
    const record = asRecord(item)
    if (!record || record.type !== 'text' || typeof record.text !== 'string') return []
    return [{ type: 'text' as const, text: record.text }]
  })
  return parts.length > 0 ? parts : null
}

function toProviderMessages(value: unknown): ProviderChatMessage[] | null {
  if (!Array.isArray(value)) return null
  const messages: ProviderChatMessage[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) return null
    const rawRole = record.role
    if (rawRole !== 'user' && rawRole !== 'assistant' && rawRole !== 'system') return null
    const content = toProviderMessageContent(record.content)
    if (content === null) return null
    messages.push({ role: rawRole, content })
  }
  return messages
}

async function readFetchRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  if (typeof init?.body === 'string') return init.body
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return await input.clone().text().catch(() => null)
  }
  return null
}

async function withOpenRouterRequestOptions(input: {
  requestInput: RequestInfo | URL
  requestInit?: RequestInit
  modelId: string
  reasoningEffort: AiProviderLanguageModelContext['reasoningEffort']
}): Promise<{ requestInput: RequestInfo | URL; requestInit?: RequestInit }> {
  const bodyText = await readFetchRequestBody(input.requestInput, input.requestInit)
  const body = bodyText ? parseRequestBody(bodyText) : null
  if (!body) {
    throw new Error('OPENROUTER_LANGUAGE_MODEL_REQUEST_BODY_INVALID')
  }
  const modelId = typeof body.model === 'string' ? body.model : input.modelId
  const messages = toProviderMessages(body.messages)
  const promptCacheRequest = messages
    ? buildOpenRouterPromptCacheRequest({ modelId, messages })
    : null
  const existingReasoning = asRecord(body.reasoning)

  const nextBody = JSON.stringify({
    ...body,
    reasoning: {
      ...(existingReasoning || {}),
      effort: input.reasoningEffort,
    },
    ...(!body.cache_control && promptCacheRequest?.cacheControl
      ? { cache_control: promptCacheRequest.cacheControl }
      : {}),
  })
  if (typeof input.requestInit?.body === 'string') {
    return {
      requestInput: input.requestInput,
      requestInit: {
        ...input.requestInit,
        body: nextBody,
      },
    }
  }
  if (typeof Request !== 'undefined' && input.requestInput instanceof Request) {
    return {
      requestInput: new Request(input.requestInput, { body: nextBody }),
      requestInit: input.requestInit,
    }
  }
  return input
}

function createOpenRouterLoggingFetch(input: {
  sessionId?: string
  modelId: string
  reasoningEffort: AiProviderLanguageModelContext['reasoningEffort']
}): typeof fetch {
  return async (requestInput, requestInit) => {
    const startedAt = Date.now()
    const prepared = await withOpenRouterRequestOptions({
      requestInput,
      requestInit,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
    })
    const response = await fetchWithProviderProxy(prepared.requestInput, prepared.requestInit)
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

export function createOpenRouterLanguageModel(input: AiProviderLanguageModelContext): LanguageModel {
  if (!input.providerConfig.baseUrl) {
    throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (language-model)')
  }
  return createOpenAiSdkLanguageModel(input, {
    fetch: createOpenRouterLoggingFetch({
      sessionId: input.openRouterSessionId,
      modelId: input.selection.modelId,
      reasoningEffort: input.reasoningEffort,
    }),
    ...(input.openRouterSessionId
      ? { headers: { 'x-session-id': input.openRouterSessionId } }
      : {}),
  })
}
