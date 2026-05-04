import { describe, expect, it } from 'vitest'
import { selectComfyUiVideoWorkflowKey } from '@/lib/generators/comfyui-video'

const MULTI_SHOT_WORKFLOW = 'basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1'
const SINGLE_SHOT_WORKFLOW = 'basevideo/图生视频/ltx2.3-图生视频-没字幕版'

describe('ComfyUI video workflow selection', () => {
  it('routes normal single-panel generation away from multi-shot workflows', () => {
    expect(selectComfyUiVideoWorkflowKey(MULTI_SHOT_WORKFLOW, 'GLOBAL: office\nLOCAL: [0-4] doctor speaks', {
      generationMode: 'normal',
    })).toBe(SINGLE_SHOT_WORKFLOW)
  })

  it('keeps multi-shot workflows only for explicit range generation', () => {
    expect(selectComfyUiVideoWorkflowKey(MULTI_SHOT_WORKFLOW, 'GLOBAL: office\nLOCAL: [0-4] doctor speaks', {
      generationMode: 'normal',
      multiShotRange: true,
    })).toBe(MULTI_SHOT_WORKFLOW)
  })

  it('does not rewrite first-last-frame workflow requests', () => {
    const firstLastWorkflow = 'basevideo/首尾帧/ltx2.3首尾帧'
    expect(selectComfyUiVideoWorkflowKey(firstLastWorkflow, 'bridge the two frames', {
      generationMode: 'firstlastframe',
    })).toBe(firstLastWorkflow)
  })
})
