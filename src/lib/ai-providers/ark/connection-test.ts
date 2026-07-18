import { createAiSdkConnectionTester } from '@/lib/ai-providers/shared/connection-test'
import { createArkLanguageModel } from './language-model'
import { ARK_PROVIDER_DEFAULT_BASE_URL, ARK_PROVIDER_TEST_LLM_MODEL_ID } from './models'

export const arkConnectionTester = createAiSdkConnectionTester({
  providerKey: 'ark',
  displayName: 'Ark',
  defaultBaseUrl: ARK_PROVIDER_DEFAULT_BASE_URL,
  defaultTestModel: ARK_PROVIDER_TEST_LLM_MODEL_ID,
  protocol: 'openai-responses',
  createLanguageModel: createArkLanguageModel,
})
