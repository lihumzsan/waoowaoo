import OpenAI from 'openai'
import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { ensureBailianCatalogRegistered } from './catalog'
import { resolveBailianCompatibleBaseUrl } from './base-url'
import type { BailianLlmMessage } from './types'

export interface BailianLlmCompletionParams {
  modelId: string
  messages: BailianLlmMessage[]
  apiKey: string
  baseUrl?: string
  temperature?: number
}

const DEFAULT_BAILIAN_LLM_TIMEOUT_MS = 3 * 60 * 1000

function resolveBailianLlmTimeoutMs(): number {
  const raw = process.env.BAILIAN_LLM_TIMEOUT_MS
  if (!raw) return DEFAULT_BAILIAN_LLM_TIMEOUT_MS

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BAILIAN_LLM_TIMEOUT_MS
  }

  return parsed
}

function createBailianTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`) as Error & {
    code?: string
    retryable?: boolean
  }
  error.name = 'TimeoutError'
  error.code = 'GENERATION_TIMEOUT'
  error.retryable = true
  return error
}

async function withBailianHardTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(createBailianTimeoutError(timeoutMs)), timeoutMs)
        if (timer && typeof timer === 'object' && 'unref' in timer) {
          timer.unref()
        }
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function assertRegistered(modelId: string): void {
  ensureBailianCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'bailian',
    modality: 'llm' satisfies OfficialModelModality,
    modelId,
  })
}

export async function completeBailianLlm(
  _params: BailianLlmCompletionParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  assertRegistered(_params.modelId)
  const timeoutMs = resolveBailianLlmTimeoutMs()
  const baseURL = resolveBailianCompatibleBaseUrl({
    apiKey: _params.apiKey,
    baseUrl: _params.baseUrl,
  })
  const client = new OpenAI({
    apiKey: _params.apiKey,
    baseURL,
    timeout: timeoutMs,
  })
  const completion = await withBailianHardTimeout(
    client.chat.completions.create({
      model: _params.modelId,
      messages: _params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: _params.temperature ?? 0.7,
    }),
    timeoutMs,
  )
  return completion as OpenAI.Chat.Completions.ChatCompletion
}
