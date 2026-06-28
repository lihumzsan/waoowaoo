import OpenAI from 'openai'
import { ARK_PROVIDER_TEST_LLM_MODEL_ID } from '@/lib/ai-providers/ark/models'
import { CodexExecError, runCodexSelfCheck } from '@/lib/ai-providers/codex/client'
import { CODEX_DEFAULT_MODEL_ID, CODEX_PROVIDER_KEY } from '@/lib/ai-providers/codex/constants'

export type TestStepName = 'models' | 'textGen' | 'imageGen' | 'credits'
export type TestStepStatus = 'pass' | 'fail' | 'skip'

export interface TestStep {
  name: TestStepName
  status: TestStepStatus
  message: string
  model?: string
  detail?: string
}

export interface TestProviderResult {
  success: boolean
  steps: TestStep[]
}

type PresetProviderType = 'ark' | 'google' | 'openrouter' | 'fal' | 'codex'

type TestProviderPayload = {
  apiType: PresetProviderType
  baseUrl?: string
  apiKey?: string
  llmModel?: string
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return 'Network error - check your internet connection'
    }
    if (error.message.includes('Connection error')) return 'Network error - temporary connection failure, please retry'
    if (error.message.includes('401')) return 'Authentication failed - check API Key'
    if (error.message.includes('403')) return 'Access denied - check API Key permissions'
    if (error.message.includes('timeout') || error.name === 'TimeoutError') return 'Request timed out'
    return error.message.slice(0, 200)
  }
  return String(error).slice(0, 200)
}

function classifyFetchFailure(status: number): string {
  if (status === 401 || status === 403) return `Authentication failed (${status})`
  if (status === 429) return `Rate limited (${status})`
  return `Provider error (${status})`
}

function createOpenAiClient(input: { apiKey: string; baseURL?: string }): OpenAI {
  return new OpenAI({
    apiKey: input.apiKey,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
    timeout: 30000,
  })
}

async function testOpenAiStyleProvider(input: {
  apiKey: string
  baseURL: string
  model: string
  providerName: string
}): Promise<TestProviderResult> {
  const client = createOpenAiClient({ apiKey: input.apiKey, baseURL: input.baseURL })
  const steps: TestStep[] = []

  try {
    await client.models.list()
    steps.push({ name: 'models', status: 'pass', message: `${input.providerName} models endpoint ok` })
  } catch (error) {
    steps.push({ name: 'models', status: 'fail', message: toErrorMessage(error) })
    steps.push({ name: 'textGen', status: 'skip', message: 'Skipped because models probe failed', model: input.model })
    return { success: false, steps }
  }

  try {
    const response = await client.chat.completions.create({
      model: input.model,
      messages: [{ role: 'user', content: '1+1=? Reply with only the number.' }],
      max_tokens: 8,
      temperature: 0,
    })
    const answer = response.choices[0]?.message?.content?.trim()
    steps.push({
      name: 'textGen',
      status: answer ? 'pass' : 'fail',
      message: answer ? 'Text generation ok' : 'Text generation returned empty response',
      model: response.model || input.model,
    })
  } catch (error) {
    steps.push({ name: 'textGen', status: 'fail', message: toErrorMessage(error), model: input.model })
  }

  return { success: steps.every((step) => step.status !== 'fail'), steps }
}

async function testGoogleProvider(apiKey: string): Promise<TestProviderResult> {
  const steps: TestStep[] = []
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
    })
    if (!response.ok) {
      steps.push({ name: 'models', status: 'fail', message: classifyFetchFailure(response.status) })
      return { success: false, steps }
    }
    steps.push({ name: 'models', status: 'pass', message: 'Google models endpoint ok' })
    return { success: true, steps }
  } catch (error) {
    steps.push({ name: 'models', status: 'fail', message: toErrorMessage(error) })
    return { success: false, steps }
  }
}

async function testFalProvider(apiKey: string): Promise<TestProviderResult> {
  const steps: TestStep[] = []
  try {
    const response = await fetch('https://fal.run/fal-ai/flux/dev', {
      method: 'OPTIONS',
      headers: { Authorization: `Key ${apiKey}` },
    })
    if (response.status === 401 || response.status === 403) {
      steps.push({ name: 'models', status: 'fail', message: classifyFetchFailure(response.status) })
      return { success: false, steps }
    }
    steps.push({ name: 'models', status: 'pass', message: 'FAL credential accepted for provider probe' })
    steps.push({ name: 'imageGen', status: 'skip', message: 'Generation probe skipped to avoid spend' })
    return { success: true, steps }
  } catch (error) {
    steps.push({ name: 'models', status: 'fail', message: toErrorMessage(error) })
    return { success: false, steps }
  }
}

function toCodexProbeMessage(error: unknown): string {
  if (error instanceof CodexExecError) {
    switch (error.code) {
      case 'CODEX_EXECUTABLE_NOT_FOUND':
        return 'Codex CLI executable not found. Install Codex desktop or configure the executable path.'
      case 'CODEX_EXEC_TIMEOUT':
        return 'Codex CLI timed out. The local Codex process may be busy or stuck.'
      case 'CODEX_EMPTY_OUTPUT':
        return 'Codex CLI returned empty output.'
      default:
        return `Codex CLI self-check failed: ${error.message.slice(0, 200)}`
    }
  }
  if (error instanceof Error) return `Codex CLI self-check failed: ${error.message.slice(0, 200)}`
  return `Codex CLI self-check failed: ${String(error).slice(0, 200)}`
}

function toCodexProbeDetail(error: unknown): string | undefined {
  if (!(error instanceof CodexExecError)) {
    if (error instanceof Error) return error.message.slice(0, 500)
    return String(error).slice(0, 500)
  }

  const parts: string[] = [`code=${error.code}`]
  if (error.exitCode !== undefined) parts.push(`exitCode=${String(error.exitCode)}`)
  if (error.signal !== undefined && error.signal !== null) parts.push(`signal=${String(error.signal)}`)
  if (error.stdout) parts.push(`stdout=${error.stdout}`)
  if (error.stderr) parts.push(`stderr=${error.stderr}`)
  return parts.join(' | ').slice(0, 500)
}

async function testCodexProvider(input: {
  codexPath?: string
  model?: string
}): Promise<TestProviderResult> {
  const model = input.model?.trim() || CODEX_DEFAULT_MODEL_ID

  try {
    const result = await runCodexSelfCheck({
      codexPath: input.codexPath?.trim() || undefined,
      model,
    })
    const seconds = Math.max(1, Math.round(result.durationMs / 1000))
    return {
      success: true,
      steps: [{
        name: 'textGen',
        status: 'pass',
        model,
        message: `Codex CLI OK (${seconds}s): ${result.text.trim()}`,
        detail: 'Local Codex CLI self-check; no API key or routekey used.',
      }],
    }
  } catch (error) {
    return {
      success: false,
      steps: [{
        name: 'textGen',
        status: 'fail',
        model,
        message: toCodexProbeMessage(error),
        detail: toCodexProbeDetail(error),
      }],
    }
  }
}

export async function testProviderConnection(payload: TestProviderPayload): Promise<TestProviderResult> {
  const apiKey = payload.apiKey?.trim() || ''
  if (!apiKey && payload.apiType !== CODEX_PROVIDER_KEY) {
    return {
      success: false,
      steps: [{ name: 'models', status: 'fail', message: 'Missing apiKey' }],
    }
  }

  switch (payload.apiType) {
    case 'ark':
      return await testOpenAiStyleProvider({
        apiKey,
        baseURL: payload.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
        model: payload.llmModel || ARK_PROVIDER_TEST_LLM_MODEL_ID,
        providerName: 'Ark',
      })
    case 'openrouter':
      return await testOpenAiStyleProvider({
        apiKey,
        baseURL: payload.baseUrl || 'https://openrouter.ai/api/v1',
        model: payload.llmModel || 'openai/gpt-4o-mini',
        providerName: 'OpenRouter',
      })
    case 'google':
      return await testGoogleProvider(apiKey)
    case 'fal':
      return await testFalProvider(apiKey)
    case 'codex':
      return await testCodexProvider({
        codexPath: payload.baseUrl,
        model: payload.llmModel,
      })
    default:
      return {
        success: false,
        steps: [{ name: 'models', status: 'fail', message: `Unsupported API type: ${String(payload.apiType)}` }],
      }
  }
}
