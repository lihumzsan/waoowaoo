import { createAiSdkConnectionTester } from '@/lib/ai-providers/shared/connection-test'
import { requireApiConfigCatalogProviderBaseUrl } from '@/lib/ai-registry/api-config-catalog'
import { createArkLanguageModel } from './language-model'
import { ARK_PROVIDER_TEST_LLM_MODEL_ID } from './models'

export const arkConnectionTester = createAiSdkConnectionTester({
  providerKey: 'ark',
  displayName: 'Ark',
  defaultBaseUrl: requireApiConfigCatalogProviderBaseUrl('ark'),
  defaultTestModel: ARK_PROVIDER_TEST_LLM_MODEL_ID,
  protocol: 'openai-responses',
  createLanguageModel: createArkLanguageModel,
})
