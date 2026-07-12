import { describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  COMFYUI_LTX23_WORKFLOW_KEYS,
  expandLtx23WorkflowImageFilenames,
  getLtx23WorkflowProfile,
  getLtx23WorkflowProfiles,
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
      maxDurationSeconds: 20,
      defaultDurationSeconds: 19.56,
      durationOptions: [4, 5, 6, 8, 10, 12, 16, 20],
      selectableInPanel: true,
    })
  })

  it('exposes only the seven current selectable workflow profiles', () => {
    expect(getLtx23WorkflowProfiles().map((profile) => profile.workflowKey)).toEqual([
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
      COMFYUI_LTX23_WORKFLOW_KEYS.microDetail,
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
      COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s,
      COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay,
      COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2,
    ])
  })

  it('expands one image into four slots for the single-image large-motion profile', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      ['first.png'],
    )).toEqual(['first.png', 'first.png', 'first.png', 'first.png'])
  })

  it('registers Goon as the fixed 24 fps first-last-frame profile', () => {
    expect(getLtx23WorkflowProfile(COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame)).toMatchObject({
      workflowKey: 'basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      category: 'first_last_frame',
      promptPolicy: 'first_last_frame',
      imageSlotPolicy: 'first_last',
      maxDurationSeconds: 12,
      defaultDurationSeconds: 10,
      durationOptions: [4, 5, 6, 8, 10, 12],
      fps: 24,
      selectableInPanel: true,
    })
  })

  it('keeps exactly the first and last images for Goon slots', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
      ['first.png', 'last.png'],
    )).toEqual(['first.png', 'last.png'])
  })

  it('uses the final uploaded image as the last frame when references sit between first and last', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
      ['first.png', 'reference.png', 'last.png'],
    )).toEqual(['first.png', 'last.png'])
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
