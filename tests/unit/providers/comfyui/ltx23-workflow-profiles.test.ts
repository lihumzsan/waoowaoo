import { describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  COMFYUI_LTX23_WORKFLOW_KEYS,
  expandLtx23WorkflowImageFilenames,
  getLtx23WorkflowProfile,
  isComfyUiLtx23LongVideoWorkflow,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'

describe('ltx23 workflow profiles', () => {
  it('defaults to the T8 Smart VBVR single-image profile', () => {
    expect(COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)
    expect(getLtx23WorkflowProfile(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)).toMatchObject({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
      category: 'single_image_precise',
      promptPolicy: 'stable_single_image',
      imageSlotPolicy: 'single',
      maxDurationSeconds: 12,
      durationOptions: [4, 5, 6, 8, 10, 12],
      selectableInPanel: true,
      postprocessOnly: false,
    })
  })

  it('keeps the existing first-last-frame workflow key compatible with the bundled workflow', () => {
    expect(COMFYUI_LTX23_WORKFLOW_KEYS.existingFirstLastFrame).toBe('basevideo/首尾帧/ltx2.3首尾帧')
  })

  it('expands one image into four slots for the single-image large-motion profile', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      ['first.png'],
    )).toEqual(['first.png', 'first.png', 'first.png', 'first.png'])
  })

  it('keeps first and last images distinct for smooth first-last-frame slots', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.smoothFirstLastFrame,
      ['first.png', 'last.png'],
    )).toEqual(['first.png', 'last.png', 'last.png'])
  })

  it('uses the final uploaded image as the last frame when references sit between first and last', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.smoothFirstLastFrame,
      ['first.png', 'reference.png', 'last.png'],
    )).toEqual(['first.png', 'last.png', 'last.png'])
  })

  it('marks long-video workflows separately', () => {
    expect(isComfyUiLtx23LongVideoWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s)).toBe(true)
    expect(isComfyUiLtx23LongVideoWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.microDetail)).toBe(false)
  })

  it('tolerates empty workflow keys and missing image filenames', () => {
    expect(getLtx23WorkflowProfile(null)).toBeNull()
    expect(isComfyUiLtx23LongVideoWorkflow(undefined)).toBe(false)
    expect(expandLtx23WorkflowImageFilenames(undefined, undefined)).toBeUndefined()
  })
})
