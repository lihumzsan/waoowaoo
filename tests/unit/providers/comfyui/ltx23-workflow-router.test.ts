import { describe, expect, it } from 'vitest'
import { COMFYUI_LTX23_WORKFLOW_KEYS } from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { resolveLtx23WorkflowRoute } from '@/lib/providers/comfyui/ltx23-workflow-router'

const DEFAULT_MODEL = `comfyui::${COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise}`

describe('ltx23 workflow router', () => {
  it('keeps non-ltx23 models outside the router', () => {
    expect(resolveLtx23WorkflowRoute({
      modelKey: 'vidu::vidu-q2',
      selectionMode: 'auto',
      panel: { description: 'woman looks at the camera' },
    })).toBeNull()
  })

  it('routes normal stable single-image shots to Smart VBVR', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      panel: { description: '年轻男子坐在桌前，表情稳定，轻声说话' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)
    expect(result?.reasons).toContain('default_single_image_precise')
  })

  it('routes micro expression and lip detail to Sulphur-2', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      panel: { description: '特写镜头，女子眼神微变，嘴角轻微颤动，口型贴合台词' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.microDetail)
    expect(result?.reasons).toContain('micro_detail_or_expression')
  })

  it('routes large motion and camera movement to the four-stage profile and stretches duration', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      requestedDurationSeconds: 6,
      panel: { description: '男子突然转身奔跑，镜头跟拍并逐渐推近' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion)
    expect(result?.durationSeconds).toBe(12)
    expect(result?.reasons).toContain('large_motion_or_camera_movement')
  })

  it('keeps in-range long large-motion requests on the four-stage profile', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      targetDurationSeconds: 16,
      panel: { description: '男子突然转身奔跑，镜头跟拍推近' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion)
    expect(result?.durationSeconds).toBe(16)
    expect(result?.reasons).toContain('large_motion_or_camera_movement')
  })

  it('routes first-last-frame generation to the smooth first-last-frame profile', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      generationMode: 'firstlastframe',
      panel: { description: 'bridge two frames' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.smoothFirstLastFrame)
    expect(result?.confidence).toBe(1)
  })

  it('routes over-24-second videos to the Damaicha 30s profile', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      targetDurationSeconds: 28,
      panel: { description: '长镜头里人物缓慢走过走廊' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s)
    expect(result?.reasons).toContain('duration_over_24s')
  })

  it('routes 12-24 second PromptRelay-like requests to Damaicha long PromptRelay', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      targetDurationSeconds: 16,
      panel: {
        videoPrompt: 'GLOBAL: hospital room. LOCAL: Scene 1：女子抬头 | Scene 2：镜头缓慢推近',
      },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay)
    expect(result?.reasons).toEqual(['duration_over_12s', 'promptrelay_or_multi_stage'])
  })

  it('preserves an explicit manual profile selection', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: `comfyui::${COMFYUI_LTX23_WORKFLOW_KEYS.microDetail}`,
      selectionMode: 'manual',
      targetDurationSeconds: 20,
      panel: { description: '男子奔跑并转身' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.microDetail)
    expect(result?.selectionMode).toBe('manual')
    expect(result?.reasons).toEqual(['manual_selection'])
  })
})
