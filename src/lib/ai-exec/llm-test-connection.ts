import OpenAI from 'openai'
import { ApiError } from '@/lib/api-errors'
import { ARK_PROVIDER_TEST_LLM_MODEL_ID } from '@/lib/ai-providers/ark/models'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

export type LlmConnectionTestProvider =
  | 'openrouter'
  | 'google'
  | 'ark'

export interface LlmConnectionTestResult {
  provider: LlmConnectionTestProvider
  message: string
  model?: string
  answer?: string
}

type TestConnectionPayload = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
}

type LlmConnectionTestPayload = {
  provider: LlmConnectionTestProvider
  apiKey: string
  baseUrl?: string
  model?: string
}

type LlmConnectionTestPartialResult = Pick<LlmConnectionTestResult, 'model' | 'answer'>

const LLM_CONNECTION_TEST_PROVIDERS = new Set<LlmConnectionTestProvider>([
  'openrouter',
  'google',
  'ark',
])

function isRegisteredLlmConnectionTestProvider(provider: string): provider is LlmConnectionTestProvider {
  return LLM_CONNECTION_TEST_PROVIDERS.has(provider as LlmConnectionTestProvider)
}

async function testGoogleAI(apiKey: string): Promise<LlmConnectionTestPartialResult> {
  const response = await fetchWithProviderProxy(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' },
  )
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Google AI probe failed (${response.status}): ${error}`)
  }
  return {}
}

async function testOpenAIStyleConnection(input: {
  apiKey: string
  baseURL: string
  model: string
}): Promise<LlmConnectionTestPartialResult> {
  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    timeout: 30000,
    fetch: fetchWithProviderProxy,
  })

  const response = await client.chat.completions.create({
    model: input.model,
    messages: [{ role: 'user', content: '1+1=? Reply with only the number.' }],
    max_tokens: 8,
    temperature: 0,
  })
  const answer = response.choices[0]?.message?.content?.trim() || ''
  return {
    model: response.model || input.model,
    answer,
  }
}

async function testRegisteredLlmConnection(payload: LlmConnectionTestPayload): Promise<LlmConnectionTestResult> {
  const tested = payload.provider === 'google'
    ? await testGoogleAI(payload.apiKey)
    : await testOpenAIStyleConnection({
      apiKey: payload.apiKey,
      baseURL: payload.baseUrl || (payload.provider === 'ark'
        ? 'https://ark.cn-beijing.volces.com/api/v3'
        : 'https://openrouter.ai/api/v1'),
      model: payload.model || (payload.provider === 'ark' ? ARK_PROVIDER_TEST_LLM_MODEL_ID : 'openai/gpt-4o-mini'),
    })

  return {
    provider: payload.provider,
    message: `${payload.provider} connection ok`,
    ...tested,
  }
}

function normalizeProvider(payload: TestConnectionPayload): LlmConnectionTestProvider {
  const provider = typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : ''
  if (!provider) {
    throw new ApiError('INVALID_PARAMS', { message: 'Missing provider' })
  }
  if (!isRegisteredLlmConnectionTestProvider(provider)) {
    throw new ApiError('INVALID_PARAMS', { message: `Unsupported provider: ${provider}` })
  }
  return provider
}

function requireApiKey(payload: TestConnectionPayload): string {
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (!apiKey) {
    throw new ApiError('INVALID_PARAMS', { message: 'Missing apiKey' })
  }
  return apiKey
}

export async function testLlmConnection(payload: TestConnectionPayload): Promise<LlmConnectionTestResult> {
  return await testRegisteredLlmConnection({
    provider: normalizeProvider(payload),
    apiKey: requireApiKey(payload),
    baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : undefined,
    model: typeof payload.model === 'string' ? payload.model.trim() : undefined,
  })
}
