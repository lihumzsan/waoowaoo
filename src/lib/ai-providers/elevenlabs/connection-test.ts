import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { captureProviderHttpFailure, createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import { projectConnectionTestFailure } from '@/lib/ai-providers/shared/connection-test'
import type {
  AiProviderConnectionTester,
  AiProviderConnectionTestStep,
} from '@/lib/ai-providers/runtime-types'
import { buildElevenLabsUrl } from './base-url'

export const elevenLabsFailureAdapter = createAiProviderFailureAdapter('elevenlabs')

export const elevenLabsConnectionTester: AiProviderConnectionTester = {
  diagnose: async (input) => {
    const steps: AiProviderConnectionTestStep[] = []
    try {
      const response = await fetchWithProviderProxy(
        buildElevenLabsUrl('/v1/user/subscription', input.baseUrl),
        {
          method: 'GET',
          headers: { 'xi-api-key': input.apiKey },
          cache: 'no-store',
        },
      )
      if (!response.ok) {
        const failure = await captureProviderHttpFailure({
          response,
          provider: 'elevenlabs',
          phase: 'connection',
        })
        steps.push({
          name: 'credits',
          status: 'fail',
          ...projectConnectionTestFailure(elevenLabsFailureAdapter, failure),
        })
        return { success: false, steps }
      }
      steps.push({ name: 'credits', status: 'pass', messageKey: 'connectionTest.modelsOk' })
      steps.push({ name: 'musicGen', status: 'skip', messageKey: 'connectionTest.skippedSpend' })
      return { success: true, steps }
    } catch (error) {
      steps.push({
        name: 'credits',
        status: 'fail',
        ...projectConnectionTestFailure(elevenLabsFailureAdapter, error),
      })
      return { success: false, steps }
    }
  },
}
