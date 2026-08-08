import { describe, expect, it } from 'vitest'
import { resolveComfyUiPromptQueuePhase } from '@/lib/ai-providers/comfyui/client'

describe('ComfyUI prompt queue state', () => {
  it('distinguishes running, pending, and absent prompts', () => {
    expect(resolveComfyUiPromptQueuePhase({ queue_running: [['meta', 'run-1']], queue_pending: [] }, 'run-1')).toBe('running')
    expect(resolveComfyUiPromptQueuePhase({ queue_running: [], queue_pending: [['meta', 'wait-1']] }, 'wait-1')).toBe('pending')
    expect(resolveComfyUiPromptQueuePhase({ queue_running: [], queue_pending: [] }, 'missing')).toBe('absent')
  })
})
