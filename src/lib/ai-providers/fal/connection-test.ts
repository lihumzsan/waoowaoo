import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  classifyConnectionProbeFailure,
  connectionTestErrorMessage,
} from '@/lib/ai-providers/shared/connection-test'
import type {
  AiProviderConnectionTester,
  AiProviderConnectionTestStep,
} from '@/lib/ai-providers/runtime-types'

const FAL_CONNECTION_PROBE_URL = 'https://fal.run/fal-ai/flux/dev'

export const falConnectionTester: AiProviderConnectionTester = {
  diagnose: async (input) => {
    const steps: AiProviderConnectionTestStep[] = []
    try {
      const response = await fetchWithProviderProxy(FAL_CONNECTION_PROBE_URL, {
        method: 'OPTIONS',
        headers: { Authorization: `Key ${input.apiKey}` },
      })
      if (response.status === 401 || response.status === 403) {
        steps.push({ name: 'models', status: 'fail', message: classifyConnectionProbeFailure(response.status) })
        return { success: false, steps }
      }
      steps.push({ name: 'models', status: 'pass', message: 'FAL credential accepted for provider probe' })
      steps.push({ name: 'imageGen', status: 'skip', message: 'Generation probe skipped to avoid spend' })
      return { success: true, steps }
    } catch (error) {
      steps.push({ name: 'models', status: 'fail', message: connectionTestErrorMessage(error) })
      return { success: false, steps }
    }
  },
}
