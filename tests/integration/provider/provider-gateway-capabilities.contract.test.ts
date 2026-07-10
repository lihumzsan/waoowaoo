import {
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
  arkAdapter,
  beforeEach,
  buildOpenRouterSessionId,
  describe,
  ensureAiCatalogsRegistered,
  expect,
  googleAdapter,
  it,
  normalizeOpenRouterSessionId,
  openRouterAdapter,
  supportsAssetReferenceMultiReferenceVideoModel,
  vi,
} from './provider-gateway-dispatch.fixture'

describe('provider contract - gateway dispatch (connection tests, session, capabilities)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureAiCatalogsRegistered()
  })

  describe('LLM session ids are derived by the owning provider adapter', () => {
    it('derives the OpenRouter session id exactly like the session module', () => {
      const derived = openRouterAdapter.resolveLlmSessionId?.({
        kind: 'llm',
        userId: 'user-1',
        projectId: 'project-1',
        action: 'analyze',
        modelKey: 'openrouter::openai/gpt-5.5',
      })
      expect(derived).toBe(buildOpenRouterSessionId({
        kind: 'llm',
        userId: 'user-1',
        projectId: 'project-1',
        action: 'analyze',
        modelKey: 'openrouter::openai/gpt-5.5',
      }))
      expect(derived).toBeTruthy()
    })

    it('prefers a normalized explicit session id over derivation', () => {
      const explicit = openRouterAdapter.resolveLlmSessionId?.({
        kind: 'vision',
        userId: 'user-1',
        modelKey: 'openrouter::openai/gpt-5.5',
        explicitSessionId: '  My Session!!  ',
      })
      expect(explicit).toBe(normalizeOpenRouterSessionId('  My Session!!  '))
      expect(explicit).toBe('My_Session')
    })

    it('leaves providers without a session concept undefined', () => {
      expect(arkAdapter.resolveLlmSessionId).toBeUndefined()
      expect(googleAdapter.resolveLlmSessionId).toBeUndefined()
    })
  })

  describe('asset-reference multi-reference video capability comes from the catalog', () => {
    it('declares all Ark video models as multi-reference capable', () => {
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::doubao-seedance-2-0-260128')).toBe(true)
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::doubao-seedance-2-0-fast-260128')).toBe(true)
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::doubao-seedance-1-0-pro-250528-batch')).toBe(true)
    })

    it('declares exactly the supported FAL video models as multi-reference capable', () => {
      for (const modelId of [
        FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_SEEDANCE_2_VIDEO_MODEL_ID,
        FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
        FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
      ]) {
        expect(supportsAssetReferenceMultiReferenceVideoModel(`fal::${modelId}`)).toBe(true)
      }
      expect(supportsAssetReferenceMultiReferenceVideoModel('fal::fal-ai/kling-video/v2.5-turbo/pro/image-to-video')).toBe(false)
    })

    it('rejects undeclared providers, unknown models, and bare model ids', () => {
      expect(supportsAssetReferenceMultiReferenceVideoModel('openrouter::bytedance/seedance-2.0')).toBe(false)
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::no-such-model')).toBe(false)
      expect(supportsAssetReferenceMultiReferenceVideoModel('doubao-seedance-2-0-260128')).toBe(false)
    })
  })
})
