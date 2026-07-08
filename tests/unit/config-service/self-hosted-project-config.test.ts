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

describe('self-hosted project model config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_EDITION = 'self-hosted'
    process.env.PROVIDER_CREDENTIAL_MODE = 'user-key'
    process.env.BILLING_MODE = 'DISABLED'
  })

  afterEach(() => restoreEnv())

  it('falls back to user default video model when an existing project has no video model fields', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      analysisModel: 'openrouter::project-analysis',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      singleShotVideoModel: null,
      sequenceVideoModel: null,
      musicModel: null,
      videoRatio: '16:9',
      capabilityOverrides: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: 'openrouter::user-analysis',
      characterModel: 'fal::user-character',
      locationModel: 'fal::user-location',
      storyboardModel: 'fal::user-storyboard',
      editModel: 'fal::user-edit',
      videoModel: 'fal::user-video',
      musicModel: 'fal::user-music',
      capabilityDefaults: null,
    })

    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config).toMatchObject({
      analysisModel: 'openrouter::project-analysis',
      characterModel: 'fal::user-character',
      locationModel: 'fal::user-location',
      storyboardModel: 'fal::user-storyboard',
      editModel: 'fal::user-edit',
      videoModel: 'fal::user-video',
      singleShotVideoModel: 'fal::user-video',
      sequenceVideoModel: 'fal::user-video',
      musicModel: 'fal::user-music',
      videoRatio: '16:9',
    })
  })
})
