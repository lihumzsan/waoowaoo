import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ModelMessage } from 'ai'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import type { AiLlmMessage } from '@/lib/ai-registry/types'
import type { AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { assertArkSubmissionResponse } from './error'

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
  if (!bodyText) throw new Error('ARK_LANGUAGE_MODEL_REQUEST_BODY_MISSING')
  const body = asRecord(JSON.parse(bodyText) as unknown)
  if (!body) throw new Error('ARK_LANGUAGE_MODEL_REQUEST_BODY_INVALID')
  return body
}

function createArkFetch(reasoning: boolean): typeof fetch {
  return async (requestInput, requestInit) => {
    const body = await readRequestBody(requestInput, requestInit)
    const nextBody = JSON.stringify({
      ...body,
      thinking: { type: reasoning ? 'enabled' : 'disabled' },
    })
    let response: Response
    if (typeof requestInit?.body === 'string') {
      response = await fetchWithProviderProxy(requestInput, { ...requestInit, body: nextBody })
      await assertArkSubmissionResponse(response)
      return response
    }
    if (typeof Request !== 'undefined' && requestInput instanceof Request) {
      response = await fetchWithProviderProxy(new Request(requestInput, { body: nextBody }), requestInit)
      await assertArkSubmissionResponse(response)
      return response
    }
    throw new Error('ARK_LANGUAGE_MODEL_REQUEST_BODY_UNSUPPORTED')
  }
}

export function prepareArkTextModelMessages(messages: AiLlmMessage[]): ModelMessage[] {
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => flattenChatMessageContent(message.content))
    .filter(Boolean)
    .join('\n')
  const conversation: ModelMessage[] = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: flattenChatMessageContent(message.content),
    }))
  if (!systemText) return conversation

  const firstUserIndex = conversation.findIndex((message) => message.role === 'user')
  if (firstUserIndex === -1) {
    return [{ role: 'user', content: systemText }, ...conversation]
  }
  const firstUser = conversation[firstUserIndex]
  if (!firstUser || typeof firstUser.content !== 'string') {
    throw new Error('ARK_SYSTEM_PROMPT_FOLD_FAILED')
  }
  conversation[firstUserIndex] = {
    role: 'user',
    content: `${systemText}\n${firstUser.content}`,
  }
  return conversation
}

export function createArkLanguageModel(input: AiProviderLanguageModelContext) {
  const baseURL = input.providerConfig.baseUrl?.trim()
  if (!baseURL) throw new Error('PROVIDER_BASE_URL_MISSING: ark (language-model)')
  const customFetch = createArkFetch(input.reasoning)

  if (input.protocol === 'openai-responses') {
    const ark = createOpenAI({
      baseURL,
      apiKey: input.providerConfig.apiKey,
      name: input.providerKey,
      fetch: customFetch,
    })
    return ark.responses(input.selection.modelId)
  }
  if (input.protocol === 'openai-compatible-chat') {
    const ark = createOpenAICompatible({
      baseURL,
      apiKey: input.providerConfig.apiKey,
      name: input.providerKey,
      fetch: customFetch,
      includeUsage: true,
    })
    return ark.chatModel(input.selection.modelId)
  }
  throw new Error(`LLM_PROTOCOL_PROVIDER_MISMATCH:ark:${input.protocol}`)
}
