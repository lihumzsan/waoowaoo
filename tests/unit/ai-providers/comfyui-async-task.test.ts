import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai-providers/comfyui/tts', () => ({
  pollComfyUiMossTts: vi.fn(async () => ({ status: 'completed' as const })),
  cancelComfyUiMossTts: vi.fn(),
}))
vi.mock('@/lib/ai-providers/comfyui/moss', () => ({ pollComfyUiMossSound: vi.fn(), cancelComfyUiMossSound: vi.fn() }))
vi.mock('@/lib/ai-providers/comfyui/h3', () => ({ pollComfyUiH3Video: vi.fn(), cancelComfyUiH3Video: vi.fn() }))

import { comfyuiAsyncTaskProvider } from '@/lib/ai-providers/comfyui/async-task'

describe('ComfyUI async voice result contract', () => {
  it('reports a voice-specific error when a completed voice result has no audio URL', async () => {
    await expect(comfyuiAsyncTaskProvider.poll({
      parsed: { provider: 'COMFYUI', type: 'VOICE', requestId: '00000000-0000-0000-0000-000000000001' },
      context: {
        userId: 'voice-user',
        getProviderConfig: vi.fn(),
        getUserModels: vi.fn(),
      },
    })).rejects.toThrow('COMFYUI_VOICE_RESULT_MISSING')
  })
})
