import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'

import { testLlmConnection } from '@/lib/ai-exec/llm-test-connection'

import { testProviderConnection } from '@/lib/ai-exec/provider-test'

import { supportsAssetReferenceMultiReferenceVideoModel } from '@/lib/ai-registry/video-model-helpers'

import { arkAdapter } from '@/lib/ai-providers/ark/adapter'

import { googleAdapter } from '@/lib/ai-providers/google/adapter'

import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'

import {
  buildOpenRouterSessionId,
  normalizeOpenRouterSessionId,
} from '@/lib/ai-providers/openrouter/session'

import {
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
} from '@/lib/ai-providers/fal/models'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('@/lib/http/outbound-proxy', () => ({
  fetchWithProviderProxy: fetchMock,
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function chatCompletionResponse(model: string, answer: string): Response {
  return jsonResponse({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [{
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: answer, refusal: null },
    }],
  })
}

function requestUrlOf(call: [RequestInfo | URL, RequestInit?]): string {
  const [input] = call
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
export { testLlmConnection } from '@/lib/ai-exec/llm-test-connection'
export { testProviderConnection } from '@/lib/ai-exec/provider-test'
export { supportsAssetReferenceMultiReferenceVideoModel } from '@/lib/ai-registry/video-model-helpers'
export { arkAdapter } from '@/lib/ai-providers/ark/adapter'
export { googleAdapter } from '@/lib/ai-providers/google/adapter'
export { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
export { buildOpenRouterSessionId, normalizeOpenRouterSessionId } from '@/lib/ai-providers/openrouter/session'
export { FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID, FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID, FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID, FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID, FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID, FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID, FAL_SEEDANCE_2_VIDEO_MODEL_ID } from '@/lib/ai-providers/fal/models'
export { chatCompletionResponse, fetchMock, jsonResponse, requestUrlOf }
