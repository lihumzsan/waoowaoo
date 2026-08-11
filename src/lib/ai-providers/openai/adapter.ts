import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'

export const openAiAdapter: AiProviderAdapter = {
  providerKey: 'openai',
  failure: createAiProviderFailureAdapter('openai'),
}
