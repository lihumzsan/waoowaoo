import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  classifyConnectionProbeFailure,
  connectionTestFailureMessageKey,
} from '@/lib/ai-providers/shared/connection-test'
import type {
  AiProviderConnectionTester,
  AiProviderConnectionTestStep,
} from '@/lib/ai-providers/runtime-types'
import { GOOGLE_PROVIDER_PROXY_TARGET } from './proxy-target'

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
      const error = await response.text()
      throw new Error(`Google AI probe failed (${response.status}): ${error}`)
    }
    return {}
  },
  diagnose: async (input) => {
    const steps: AiProviderConnectionTestStep[] = []
    try {
      const response = await probeGoogleModels(input.apiKey)
      if (!response.ok) {
        steps.push({ name: 'models', status: 'fail', messageKey: classifyConnectionProbeFailure(response.status) })
        return { success: false, steps }
      }
      steps.push({ name: 'models', status: 'pass', messageKey: 'connectionTest.modelsOk' })
      return { success: true, steps }
    } catch (error) {
      steps.push({ name: 'models', status: 'fail', messageKey: connectionTestFailureMessageKey(error) })
      return { success: false, steps }
    }
  },
}
