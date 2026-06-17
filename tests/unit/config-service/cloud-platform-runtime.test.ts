import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { getProjectModelConfig } from '@/lib/config-service'

const ENV_KEYS = [
  'DEPLOYMENT_EDITION',
  'PROVIDER_CREDENTIAL_MODE',
  'BILLING_MODE',
  'PLATFORM_VIDEO_RESOLUTION',
] as const

const ORIGINAL_ENV: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
for (const key of ENV_KEYS) {
  const value = process.env[key]
  if (value !== undefined) ORIGINAL_ENV[key] = value
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('cloud platform runtime project config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'
    process.env.PLATFORM_VIDEO_RESOLUTION = '480p'
  })

  afterEach(() => restoreEnv())

  it('uses platform-owned models and runtime options while preserving project video ratio', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      analysisModel: 'openai::user-analysis',
      characterModel: 'openai::user-image',
      locationModel: 'openai::user-location',
      storyboardModel: 'openai::user-storyboard',
      editModel: 'openai::user-edit',
      videoModel: 'fal::user-video',
      singleShotVideoModel: 'fal::user-single-video',
      sequenceVideoModel: 'fal::user-sequence-video',
      musicModel: 'google::user-music',
      videoRatio: '21:9',
      capabilityOverrides: JSON.stringify({
        'fal::user-video': { resolution: '1080p' },
      }),
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: 'openai::pref-analysis',
      musicModel: 'google::pref-music',
      capabilityDefaults: JSON.stringify({
        'fal::user-image': { resolution: '1K' },
      }),
    })

    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config).toEqual({
      analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
      characterModel: 'fal::gpt-image-2',
      locationModel: 'fal::gpt-image-2',
      storyboardModel: 'fal::gpt-image-2',
      editModel: 'fal::gpt-image-2',
      videoModel: 'openrouter::bytedance/seedance-2.0-fast',
      singleShotVideoModel: 'openrouter::bytedance/seedance-2.0-fast',
      sequenceVideoModel: 'openrouter::bytedance/seedance-2.0-fast',
      musicModel: 'fal::fal-ai/lyria3/pro',
      videoRatio: '21:9',
      capabilityDefaults: {
        'openrouter::bytedance/seedance-2.0-fast': {
          resolution: '480p',
          generateAudio: false,
        },
      },
      capabilityOverrides: {},
    })
    expect(prismaMock.userPreference.findUnique.mock.calls).toEqual([])
  })
})
