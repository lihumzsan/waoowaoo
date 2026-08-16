import { describe, expect, it } from 'vitest'
import {
  formatComfyUiExternalId,
  parseComfyUiExternalId,
} from '@/lib/ai-providers/comfyui/external-id'

const PROMPT_ID = '00000000-0000-4000-8000-000000000001'

describe('ComfyUI external id protocol', () => {
  it('round-trips a target-aware H3 id', () => {
    const externalId = formatComfyUiExternalId({
      targetId: 'h3-dual-stage-2mp',
      type: 'VIDEO',
      requestId: PROMPT_ID,
    })

    expect(externalId).toBe(`COMFYUI:h3-dual-stage-2mp:VIDEO:${PROMPT_ID}`)
    expect(parseComfyUiExternalId(externalId)).toEqual({
      provider: 'COMFYUI',
      endpoint: 'h3-dual-stage-2mp',
      type: 'VIDEO',
      requestId: PROMPT_ID,
    })
  })

  it.each([
    `COMFYUI:VIDEO:${PROMPT_ID}`,
    `COMFYUI:unknown:VIDEO:${PROMPT_ID}`,
    `COMFYUI:shared:IMAGE:${PROMPT_ID}`,
    'COMFYUI:shared:VOICE:not-a-uuid',
    `COMFYUI:shared:VOICE:${PROMPT_ID}:extra`,
  ])('rejects a non-canonical id: %s', (externalId) => {
    expect(() => parseComfyUiExternalId(externalId)).toThrow('Invalid COMFYUI externalId')
  })
})
