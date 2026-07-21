import { describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  COMFYUI_LTX23_WORKFLOW_KEYS,
  expandLtx23WorkflowImageFilenames,
  getLtx23WorkflowProfile,
  getLtx23WorkflowProfiles,
  isComfyUiLtx23LongVideoWorkflow,
  normalizeLtx23GoonDurationSeconds,
  resolveLtx23GoonFinalFrameIndex,
  resolveLtx23GoonFrameCount,
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

  it('registers the KJ multi-shot PromptRelay workflow as a fixed 720p profile', () => {
    expect(getLtx23WorkflowProfile(COMFYUI_LTX23_WORKFLOW_KEYS.multiShotPromptRelayKj)).toMatchObject({
      workflowKey: 'basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      label: 'ComfyUI · LTX2.3 多镜头精准 PromptRelay 720p',
      category: 'multi_shot_precise',
      promptPolicy: 'long_promptrelay',
      imageSlotPolicy: 'single',
      maxDurationSeconds: 20,
      defaultDurationSeconds: 19.56,
      durationOptions: [4, 5, 6, 8, 10, 12, 16, 20],
      fps: 25,
      selectableInPanel: true,
    })
  })

  it('exposes only the eight current selectable workflow profiles', () => {
    expect(getLtx23WorkflowProfiles().map((profile) => profile.workflowKey)).toEqual([
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
      COMFYUI_LTX23_WORKFLOW_KEYS.microDetail,
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
      COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s,
      COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay,
      COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2,
      COMFYUI_LTX23_WORKFLOW_KEYS.multiShotPromptRelayKj,
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
      maxDurationSeconds: 15,
      defaultDurationSeconds: 10,
      durationOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      fps: 24,
      selectableInPanel: true,
    })
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])(
    'accepts %s seconds for Goon first-last-frame normalization',
    (duration) => {
      expect(normalizeLtx23GoonDurationSeconds(duration)).toBe(duration)
    },
  )

  it.each([
    [0, 10],
    [15.5, 10],
    [16, 10],
    ['8', 10],
    [Number.NaN, 10],
  ])('falls invalid Goon duration %j back to default %s', (input, expected) => {
    expect(normalizeLtx23GoonDurationSeconds(input)).toBe(expected)
  })

  it.each([
    [1, 25],
    [4, 97],
    [8, 193],
    [10, 241],
    [15, 361],
  ])('computes the Goon 8n+1 frame count for %ss', (duration, frameCount) => {
    expect(resolveLtx23GoonFrameCount(duration)).toBe(frameCount)
    expect(resolveLtx23GoonFinalFrameIndex(duration)).toBe(frameCount - 1)
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
