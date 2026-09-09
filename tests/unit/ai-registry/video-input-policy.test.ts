import { describe, expect, it } from 'vitest'
import {
  isVideoContinuationSourceAspectRatioSupported,
  resolveVideoInputPolicySelection,
} from '@/lib/ai-registry/video-input-policy'
import { COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES, COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'

function h3Capabilities() {
  const entry = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find(({ modelId }) => modelId === COMFYUI_H3_MODEL_ID)
  if (!entry || !('video' in entry.capabilities)) throw new Error('H3_TEST_CAPABILITY_MISSING')
  return entry.capabilities.video
}

describe('video input policy', () => {
  it('matches a continuation source against every explicitly allowed rational canvas', () => {
    const allowedSourceAspectRatios = [
      { width: 2064, height: 1152 },
      { width: 1920, height: 1088 },
    ]
    expect(isVideoContinuationSourceAspectRatioSupported({
      sourceWidth: 1920,
      sourceHeight: 1088,
      allowedSourceAspectRatios,
    })).toBe(true)
    expect(isVideoContinuationSourceAspectRatioSupported({
      sourceWidth: 1920,
      sourceHeight: 1080,
      allowedSourceAspectRatios,
    })).toBe(false)
  })

  it.each([
    'reference', 'first_frame', 'first_last_frame', 'continuation',
  ] as const)('accepts the complete 4-15 second H3 boundary for %s', (inputMode) => {
    expect(resolveVideoInputPolicySelection({
      capabilities: h3Capabilities(), inputMode, requestedDurationSeconds: 4, aspectRatio: '21:9',
    })).toEqual({ inputMode, requestedDurationSeconds: 4, aspectRatio: '21:9' })
    expect(resolveVideoInputPolicySelection({
      capabilities: h3Capabilities(), inputMode, requestedDurationSeconds: 15, aspectRatio: '9:21',
    })).toEqual({ inputMode, requestedDurationSeconds: 15, aspectRatio: '9:21' })
  })

  it.each([
    ['reference', 3], ['first_frame', 16], ['first_last_frame', 3], ['continuation', 16],
  ] as const)('rejects %s duration outside the shared H3 boundary', (inputMode, requestedDurationSeconds) => {
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
