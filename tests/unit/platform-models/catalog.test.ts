import { afterEach, describe, expect, it } from 'vitest'
import { getPlatformDefaultModels, getPlatformModels } from '@/lib/platform-models/catalog'

const ORIGINAL_ENV = {
  PLATFORM_DEFAULT_ANALYSIS_MODEL: process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL,
}

function restoreEnv() {
  if (ORIGINAL_ENV.PLATFORM_DEFAULT_ANALYSIS_MODEL === undefined) {
    delete process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL
  } else {
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = ORIGINAL_ENV.PLATFORM_DEFAULT_ANALYSIS_MODEL
  }
}

describe('platform model catalog', () => {
  afterEach(() => restoreEnv())

  it('provides platform models and complete defaults', () => {
    const models = getPlatformModels()
    const modelKeys = models.map((model) => model.modelKey)

    expect(modelKeys).toContain('google::gemini-3-flash-preview')
    expect(modelKeys).toContain('fal::banana-2')
    expect(modelKeys).toContain('ark::doubao-seedance-2-0-260128')

    expect(getPlatformDefaultModels()).toEqual({
      analysisModel: 'google::gemini-3-flash-preview',
      characterModel: 'fal::banana-2',
      locationModel: 'fal::banana-2',
      storyboardModel: 'fal::banana-2',
      editModel: 'fal::banana-2',
      videoModel: 'ark::doubao-seedance-2-0-260128',
      musicModel: 'google::lyria-3-pro-preview',
    })
  })

  it('fails explicitly when a platform default model override is not in the catalog', () => {
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = 'google::missing-model'

    expect(() => getPlatformDefaultModels()).toThrow('PLATFORM_DEFAULT_MODEL_NOT_FOUND')
  })
})
