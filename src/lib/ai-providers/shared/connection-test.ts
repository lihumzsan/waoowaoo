import OpenAI from 'openai'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import type {
  AiProviderConnectionTester,
  AiProviderConnectionTestStep,
} from '@/lib/ai-providers/runtime-types'

export function connectionTestErrorMessage(error: unknown): string {
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

export function classifyConnectionProbeFailure(status: number): string {
  if (status === 401 || status === 403) return `Authentication failed (${status})`
  if (status === 429) return `Rate limited (${status})`
  return `Provider error (${status})`
}

function createOpenAiClient(input: { apiKey: string; baseURL: string }): OpenAI {
  return new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    timeout: 30000,
    fetch: fetchWithProviderProxy,
  })
}

export function createOpenAiStyleConnectionTester(defaults: {
  displayName: string
  defaultBaseUrl: string
  defaultTestModel: string
}): AiProviderConnectionTester {
  return {
    testLlm: async (input) => {
      const client = createOpenAiClient({
        apiKey: input.apiKey,
        baseURL: input.baseUrl || defaults.defaultBaseUrl,
      })
      const model = input.model || defaults.defaultTestModel
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: '1+1=? Reply with only the number.' }],
        max_tokens: 8,
        temperature: 0,
      })
      const answer = response.choices[0]?.message?.content?.trim() || ''
      return {
        model: response.model || model,
        answer,
      }
    },
    diagnose: async (input) => {
      const client = createOpenAiClient({
        apiKey: input.apiKey,
        baseURL: input.baseUrl || defaults.defaultBaseUrl,
      })
      const model = input.llmModel || defaults.defaultTestModel
      const steps: AiProviderConnectionTestStep[] = []

      try {
        await client.models.list()
        steps.push({ name: 'models', status: 'pass', message: `${defaults.displayName} models endpoint ok` })
      } catch (error) {
        steps.push({ name: 'models', status: 'fail', message: connectionTestErrorMessage(error) })
        steps.push({ name: 'textGen', status: 'skip', message: 'Skipped because models probe failed', model })
        return { success: false, steps }
      }

      try {
        const response = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: '1+1=? Reply with only the number.' }],
          max_tokens: 8,
          temperature: 0,
        })
        const answer = response.choices[0]?.message?.content?.trim()
        steps.push({
          name: 'textGen',
          status: answer ? 'pass' : 'fail',
          message: answer ? 'Text generation ok' : 'Text generation returned empty response',
          model: response.model || model,
        })
      } catch (error) {
        steps.push({ name: 'textGen', status: 'fail', message: connectionTestErrorMessage(error), model })
      }

      return { success: steps.every((step) => step.status !== 'fail'), steps }
    },
  }
}
