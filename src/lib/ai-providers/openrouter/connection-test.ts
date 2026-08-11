import { createAiSdkConnectionTester } from '@/lib/ai-providers/shared/connection-test'
import { requireApiConfigCatalogProviderBaseUrl } from '@/lib/ai-registry/api-config-catalog'
import { createOpenRouterLanguageModel } from './language-model'
import { OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID } from './models'
import { openRouterFailureAdapter } from './error-normalization'

export const openRouterConnectionTester = createAiSdkConnectionTester({
  providerKey: 'openrouter',
  failure: openRouterFailureAdapter,
  displayName: 'OpenRouter',
  defaultBaseUrl: requireApiConfigCatalogProviderBaseUrl('openrouter'),
  defaultTestModel: OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID,
  protocol: 'openrouter-chat',
  createLanguageModel: createOpenRouterLanguageModel,
})
