import { describe, expect, it } from 'vitest'
import { resolveVideoInputPolicySelection } from '@/lib/ai-registry/video-input-policy'
import { COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES, COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'

function h3Capabilities() {
  const entry = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find(({ modelId }) => modelId === COMFYUI_H3_MODEL_ID)
  if (!entry || !('video' in entry.capabilities)) throw new Error('H3_TEST_CAPABILITY_MISSING')
  return entry.capabilities.video
}

describe('video input policy', () => {
  it('accepts the complete H3 reference duration and aspect-ratio boundary', () => {
    expect(resolveVideoInputPolicySelection({
      capabilities: h3Capabilities(), inputMode: 'reference', requestedDurationSeconds: 15, aspectRatio: '9:21',
    })).toEqual({ inputMode: 'reference', requestedDurationSeconds: 15, aspectRatio: '9:21' })
  })

  it.each([
    ['first_frame', 12], ['first_last_frame', 12], ['continuation', 12],
  ] as const)('does not leak the reference duration expansion into %s', (inputMode, requestedDurationSeconds) => {
    expect(() => resolveVideoInputPolicySelection({
      capabilities: h3Capabilities(), inputMode, requestedDurationSeconds, aspectRatio: '16:9',
    })).toThrow(`VIDEO_INPUT_MODE_DURATION_UNSUPPORTED:${inputMode}:${String(requestedDurationSeconds)}`)
  })

  it('rejects an undeclared ratio rather than approximating it', () => {
    expect(() => resolveVideoInputPolicySelection({
      capabilities: h3Capabilities(), inputMode: 'reference', requestedDurationSeconds: 10, aspectRatio: '2:3',
    })).toThrow('VIDEO_ASPECT_RATIO_UNSUPPORTED:2:3')
  })
})
