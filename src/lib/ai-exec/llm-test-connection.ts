import OpenAI from 'openai'
import { ApiError } from '@/lib/api-errors'
import { ARK_PROVIDER_TEST_LLM_MODEL_ID } from '@/lib/ai-providers/ark/models'
import { CODEX_DEFAULT_MODEL_ID } from '@/lib/ai-providers/codex/constants'
import { runCodexSelfCheck } from '@/lib/ai-providers/codex/client'

export type LlmConnectionTestProvider =
  | 'openrouter'
  | 'google'
  | 'ark'
  | 'codex'

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
  apiKey?: string
  baseUrl?: string
  model?: string
}

type LlmConnectionTestPartialResult = Pick<LlmConnectionTestResult, 'model' | 'answer'>
type LlmConnectionTester = (payload: LlmConnectionTestPayload) => Promise<LlmConnectionTestPartialResult>

const LLM_CONNECTION_TEST_PROVIDERS = new Set<LlmConnectionTestProvider>([
  'openrouter',
  'google',
  'ark',
  'codex',
])
const LLM_CONNECTION_API_KEY_REQUIRED_PROVIDERS = new Set<LlmConnectionTestProvider>([
  'openrouter',
  'google',
  'ark',
])
const OPENAI_STYLE_CONNECTION_DEFAULTS = new Map<LlmConnectionTestProvider, { baseURL: string; model: string }>([
  ['ark', { baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: ARK_PROVIDER_TEST_LLM_MODEL_ID }],
  ['openrouter', { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' }],
])

function isRegisteredLlmConnectionTestProvider(provider: string): provider is LlmConnectionTestProvider {
  return LLM_CONNECTION_TEST_PROVIDERS.has(provider as LlmConnectionTestProvider)
}

async function testGoogleAI(apiKey: string): Promise<LlmConnectionTestPartialResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' },
  )
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Google AI probe failed (${response.status}): ${error}`)
  }
  return {}
}

function requireConnectionApiKey(payload: LlmConnectionTestPayload): string {
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (!apiKey && LLM_CONNECTION_API_KEY_REQUIRED_PROVIDERS.has(payload.provider)) {
    throw new ApiError('INVALID_PARAMS', { message: 'Missing apiKey' })
  }
  return apiKey
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

async function testRegisteredOpenAIStyleConnection(payload: LlmConnectionTestPayload): Promise<LlmConnectionTestPartialResult> {
  const defaults = OPENAI_STYLE_CONNECTION_DEFAULTS.get(payload.provider)
  if (!defaults) {
    throw new ApiError('INVALID_PARAMS', { message: `Unsupported provider: ${payload.provider}` })
  }
  return await testOpenAIStyleConnection({
    apiKey: requireConnectionApiKey(payload),
    baseURL: payload.baseUrl || defaults.baseURL,
    model: payload.model || defaults.model,
  })
}

async function testRegisteredGoogleConnection(payload: LlmConnectionTestPayload): Promise<LlmConnectionTestPartialResult> {
  return await testGoogleAI(requireConnectionApiKey(payload))
}

async function testRegisteredCodexConnection(payload: LlmConnectionTestPayload): Promise<LlmConnectionTestPartialResult> {
  const model = payload.model || CODEX_DEFAULT_MODEL_ID
  const result = await runCodexSelfCheck({
    codexPath: payload.baseUrl,
    model,
    timeoutMs: 60_000,
  })
  return {
    model,
    answer: result.text,
  }
}

const LLM_CONNECTION_TESTERS: Record<LlmConnectionTestProvider, LlmConnectionTester> = {
  openrouter: testRegisteredOpenAIStyleConnection,
  google: testRegisteredGoogleConnection,
  ark: testRegisteredOpenAIStyleConnection,
  codex: testRegisteredCodexConnection,
}

async function testRegisteredLlmConnection(payload: LlmConnectionTestPayload): Promise<LlmConnectionTestResult> {
  const tested = await LLM_CONNECTION_TESTERS[payload.provider](payload)

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

export async function testLlmConnection(payload: TestConnectionPayload): Promise<LlmConnectionTestResult> {
  const provider = normalizeProvider(payload)
  return await testRegisteredLlmConnection({
    provider,
    apiKey: typeof payload.apiKey === 'string' ? payload.apiKey.trim() : undefined,
    baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : undefined,
    model: typeof payload.model === 'string' ? payload.model.trim() : undefined,
  })
}
