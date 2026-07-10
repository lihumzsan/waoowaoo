import { createOpenAiStyleConnectionTester } from '@/lib/ai-providers/shared/connection-test'
import { OPENROUTER_PROVIDER_DEFAULT_BASE_URL, OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID } from './models'

export const openRouterConnectionTester = createOpenAiStyleConnectionTester({
  displayName: 'OpenRouter',
  defaultBaseUrl: OPENROUTER_PROVIDER_DEFAULT_BASE_URL,
  defaultTestModel: OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID,
})
