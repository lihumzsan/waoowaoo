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

const FAL_CONNECTION_PROBE_URL = 'https://fal.run/fal-ai/flux/dev'
export const falFailureAdapter = createAiProviderFailureAdapter('fal')

export const falConnectionTester: AiProviderConnectionTester = {
  diagnose: async (input) => {
    const steps: AiProviderConnectionTestStep[] = []
    try {
      const response = await fetchWithProviderProxy(FAL_CONNECTION_PROBE_URL, {
        method: 'OPTIONS',
        headers: { Authorization: `Key ${input.apiKey}` },
      })
      if (response.status === 401 || response.status === 403) {
        const failure = await captureProviderHttpFailure({
          response,
          provider: 'fal',
          phase: 'connection',
        })
        steps.push({ name: 'models', status: 'fail', ...projectConnectionTestFailure(falFailureAdapter, failure) })
        return { success: false, steps }
      }
      steps.push({ name: 'models', status: 'pass', messageKey: 'connectionTest.modelsOk' })
      steps.push({ name: 'imageGen', status: 'skip', messageKey: 'connectionTest.skippedSpend' })
      return { success: true, steps }
    } catch (error) {
      steps.push({ name: 'models', status: 'fail', ...projectConnectionTestFailure(falFailureAdapter, error) })
      return { success: false, steps }
    }
  },
}
