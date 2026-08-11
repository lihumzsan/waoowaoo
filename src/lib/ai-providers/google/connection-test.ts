import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  projectConnectionTestFailure,
} from '@/lib/ai-providers/shared/connection-test'
import {
  captureProviderHttpFailure,
  createAiProviderFailureAdapter,
} from '@/lib/ai-providers/failure'
import type {
  AiProviderConnectionTester,
  AiProviderConnectionTestStep,
} from '@/lib/ai-providers/runtime-types'
import { GOOGLE_PROVIDER_PROXY_TARGET } from './proxy-target'

export const googleFailureAdapter = createAiProviderFailureAdapter('google')

async function probeGoogleModels(apiKey: string): Promise<Response> {
  return await fetchWithProviderProxy(
    `${GOOGLE_PROVIDER_PROXY_TARGET}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' },
  )
}

export const googleConnectionTester: AiProviderConnectionTester = {
  testLlm: async (input) => {
    const response = await probeGoogleModels(input.apiKey)
    if (!response.ok) {
      throw await captureProviderHttpFailure({
        response,
        provider: 'google',
        phase: 'connection',
      })
    }
    return {}
  },
  diagnose: async (input) => {
    const steps: AiProviderConnectionTestStep[] = []
    try {
      const response = await probeGoogleModels(input.apiKey)
      if (!response.ok) {
        const failure = await captureProviderHttpFailure({
          response,
          provider: 'google',
          phase: 'connection',
        })
        steps.push({ name: 'models', status: 'fail', ...projectConnectionTestFailure(googleFailureAdapter, failure) })
        return { success: false, steps }
      }
      steps.push({ name: 'models', status: 'pass', messageKey: 'connectionTest.modelsOk' })
      return { success: true, steps }
    } catch (error) {
      steps.push({ name: 'models', status: 'fail', ...projectConnectionTestFailure(googleFailureAdapter, error) })
      return { success: false, steps }
    }
  },
}
