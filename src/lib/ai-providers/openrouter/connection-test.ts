import { createAiSdkConnectionTester } from '@/lib/ai-providers/shared/connection-test'
import { createOpenRouterLanguageModel } from './language-model'
import { OPENROUTER_PROVIDER_DEFAULT_BASE_URL, OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID } from './models'

export const openRouterConnectionTester = createAiSdkConnectionTester({
  providerKey: 'openrouter',
  displayName: 'OpenRouter',
  defaultBaseUrl: OPENROUTER_PROVIDER_DEFAULT_BASE_URL,
  defaultTestModel: OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID,
  protocol: 'openrouter-chat',
  createLanguageModel: createOpenRouterLanguageModel,
})
