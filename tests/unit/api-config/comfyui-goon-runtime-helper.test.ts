import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { resolveModelSelection } from '@/lib/api-config'

const GOON_MODEL_KEY = 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage'
const KJ_MULTISHOT_MODEL_KEY = 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p'

describe('ComfyUI Goon runtime helper model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: '[]',
      customProviders: JSON.stringify([
        {
          id: 'comfyui',
          name: 'ComfyUI',
          baseUrl: 'http://192.168.1.112:8188',
        },
      ]),
    })
  })

  it('resolves the auto-enabled Goon workflow for video execution', async () => {
    await expect(
      resolveModelSelection('user-1', GOON_MODEL_KEY, 'video'),
    ).resolves.toMatchObject({
      provider: 'comfyui',
      modelId: 'basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      modelKey: GOON_MODEL_KEY,
      mediaType: 'video',
    })
  })

  it('resolves the auto-enabled KJ multi-shot workflow for video execution', async () => {
    await expect(
      resolveModelSelection('user-1', KJ_MULTISHOT_MODEL_KEY, 'video'),
    ).resolves.toMatchObject({
      provider: 'comfyui',
      modelId: 'basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      modelKey: KJ_MULTISHOT_MODEL_KEY,
      mediaType: 'video',
    })
  })
})
