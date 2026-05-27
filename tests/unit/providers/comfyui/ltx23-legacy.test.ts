import { describe, expect, it } from 'vitest'
import { COMFYUI_LTX23_WORKFLOW_KEYS } from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { isRemovedLegacyLtx23WorkflowKey } from '@/lib/providers/comfyui/ltx23-legacy'

describe('removed legacy LTX2.3 workflow keys', () => {
  it('detects old non-profile ComfyUI LTX2.3 video workflows', () => {
    expect(isRemovedLegacyLtx23WorkflowKey(
      'comfyui::basevideo/demo/LTX2.3-fast',
    )).toBe(true)
    expect(isRemovedLegacyLtx23WorkflowKey(
      'basevideo/legacy/LTX-2.3-prompt-relay',
    )).toBe(true)
    expect(isRemovedLegacyLtx23WorkflowKey(
      'basevideo/legacy/ltx23-old-vbvr',
    )).toBe(true)
  })

  it('does not mark new profile workflows as legacy', () => {
    expect(isRemovedLegacyLtx23WorkflowKey(
      `comfyui::${COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise}`,
    )).toBe(false)
    expect(isRemovedLegacyLtx23WorkflowKey(
      COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay,
    )).toBe(false)
  })

  it('ignores non-ComfyUI and non-LTX2.3 model keys', () => {
    expect(isRemovedLegacyLtx23WorkflowKey('fal::seedance/video')).toBe(false)
    expect(isRemovedLegacyLtx23WorkflowKey('comfyui::baseimage/demo/LTX2.3-image')).toBe(false)
    expect(isRemovedLegacyLtx23WorkflowKey(null)).toBe(false)
  })
})
