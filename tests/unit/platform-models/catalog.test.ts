import { afterEach, describe, expect, it } from 'vitest'
import { getPlatformDefaultModels, getPlatformModels } from '@/lib/platform-models/catalog'

const ORIGINAL_ENV = {
  PLATFORM_DEFAULT_ASSISTANT_MODEL: process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL,
  PLATFORM_DEFAULT_ANALYSIS_MODEL: process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL,
}

function restoreEnv() {
  if (ORIGINAL_ENV.PLATFORM_DEFAULT_ASSISTANT_MODEL === undefined) {
    delete process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL
  } else {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = ORIGINAL_ENV.PLATFORM_DEFAULT_ASSISTANT_MODEL
  }
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

    expect(modelKeys).toContain('google::gemini-3.5-flash')
    expect(modelKeys).toContain('openrouter::google/gemini-3.5-flash')
    expect(modelKeys).toContain('fal::gpt-image-2')
    expect(modelKeys).toContain('fal::fal-ai/lyria3/pro')
    expect(modelKeys).toContain('ark::doubao-seedance-2-0-260128')
    expect(modelKeys).toContain('openrouter::anthropic/claude-sonnet-4.6')
    expect(modelKeys).toContain('openrouter::openai/gpt-5.5')
    expect(modelKeys).toContain('openrouter::openai/gpt-5.6-luna')
    expect(modelKeys).toContain('openrouter::openai/gpt-5.6-terra')
    expect(modelKeys).toContain('openrouter::openai/gpt-5.6-sol')
    expect(modelKeys).toContain('openrouter::bytedance/seedance-2.0')
    expect(modelKeys).toContain('openrouter::bytedance/seedance-2.0-fast')

    expect(getPlatformDefaultModels()).toEqual({
      assistantModel: 'openrouter::openai/gpt-5.5',
      analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
      characterModel: 'fal::gpt-image-2',
      locationModel: 'fal::gpt-image-2',
      editModel: 'fal::gpt-image-2',
      videoModel: 'openrouter::bytedance/seedance-2.0-fast',
      musicModel: 'fal::fal-ai/lyria3/pro',
    })
  })

  it('fails explicitly when a platform default model override is not in the catalog', () => {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = 'google::missing-model'

    expect(() => getPlatformDefaultModels()).toThrow('PLATFORM_DEFAULT_MODEL_NOT_FOUND')
  })

  it('accepts GPT-5.6 Luna and Sol as separate platform model overrides', () => {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = 'openrouter::openai/gpt-5.6-sol'
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = 'openrouter::openai/gpt-5.6-luna'

    expect(getPlatformDefaultModels().assistantModel).toBe('openrouter::openai/gpt-5.6-sol')
    expect(getPlatformDefaultModels().analysisModel).toBe('openrouter::openai/gpt-5.6-luna')
  })
})
