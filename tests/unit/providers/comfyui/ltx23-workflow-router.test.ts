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

  it('keeps audio-backed Smart VBVR requests on the Smart VBVR workflow up to its profile max', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      audioDurationSeconds: 19.56,
      panel: {
        videoPrompt: 'GLOBAL: rainy street. LOCAL: Scene 1: subject walks | Scene 2: camera moves up | Scene 3: subject turns | Scene 4: camera pulls back',
      },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)
    expect(result?.durationSeconds).toBe(19.56)
    expect(result?.reasons).toContain('audio_backed_smart_vbvr')
  })

  it('keeps slow Chinese push-in camera prompts on the single-image profile for 12s', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      requestedDurationSeconds: 4,
      panel: {
        videoPrompt: '\u60e8\u767d\u767d\u70bd\u706f\u5782\u5728\u591c\u95f4\u529e\u516c\u5ba4\u4e2d\u592e\uff0c\u4e2d\u5e74\u7537\u5b50\u5750\u5728\u4e66\u684c\u540e\u4fa7\u9760\u5899\u7684\u6905\u5b50\u4e0a\u5fae\u5fae\u524d\u503e\uff0c\u5e74\u8f7b\u7537\u5b50\u5750\u5728\u4e66\u684c\u524d\u4fa7\u9762\u5411\u4e66\u684c\u7684\u6905\u5b50\u4e0a\u62ac\u773c\u5bf9\u89c6\uff0c\u56db\u5468\u7a7a\u5899\u548c\u6697\u89d2\u538b\u4f4f\u7a7a\u95f4\uff0c\u955c\u5934\u7f13\u6162\u63a8\u8fdb\u4fef\u62cd',
        shotType: '\u4fef\u62cd\u8fdc\u666f',
        cameraMove: '\u7f13\u6162\u63a8\u8fdb',
      },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)
    expect(result?.durationSeconds).toBe(12)
    expect(result?.reasons).toContain('slow_stable_camera_movement')
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

  it('routes first-last-frame generation to Goon with its default duration and fixed fps', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'auto',
      generationMode: 'firstlastframe',
      panel: { description: 'bridge two frames' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame)
    expect(result?.durationSeconds).toBe(10)
    expect(result?.fps).toBe(24)
    expect(result?.confidence).toBe(1)
  })

  it('routes manual LTX2.3 first-last-frame requests to Goon', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      selectionMode: 'manual',
      generationMode: 'firstlastframe',
      requestedDurationSeconds: 5,
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame)
    expect(result?.durationSeconds).toBe(5)
    expect(result?.fps).toBe(24)
    expect(result?.reasons).toContain('first_last_frame_generation')
  })

  it.each([7, 15])('routes supported %s-second first-last-frame requests to Goon without fallback', (duration) => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: DEFAULT_MODEL,
      generationMode: 'firstlastframe',
      requestedDurationSeconds: duration,
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame)
    expect(result?.durationSeconds).toBe(duration)
    expect(result?.fps).toBe(24)
  })

  it('falls back from a first-last-frame-only model when the request is normal generation', () => {
    const result = resolveLtx23WorkflowRoute({
      modelKey: `comfyui::${COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame}`,
      generationMode: 'normal',
      requestedDurationSeconds: 6,
      panel: { description: 'two people sit still in an office' },
    })

    expect(result?.selectedWorkflowKey).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)
    expect(result?.selectionMode).toBe('auto')
    expect(result?.routed).toBe(true)
    expect(result?.reasons).toContain('first_last_frame_model_in_normal_mode')
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
