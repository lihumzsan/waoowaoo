import { describe, expect, it } from 'vitest'
import { extractTaskModelKeys, taskUsesComfyUiProvider } from '@/lib/task/service'

describe('task service model detection', () => {
  it('detects ComfyUI tasks from legacy task metadata model keys', () => {
    expect(taskUsesComfyUiProvider({
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: 'video_panel',
        apiType: 'video',
        model: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 0,
        action: 'video_panel',
      },
    })).toBe(true)
  })

  it('detects first-last-frame ComfyUI tasks from nested payload model keys', () => {
    expect(extractTaskModelKeys({
      payload: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        firstLastFrame: {
          flModel: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
        },
      },
    })).toEqual([
      'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
    ])
  })

  it('does not mark cloud-provider tasks as ComfyUI', () => {
    expect(taskUsesComfyUiProvider({
      payload: {
        videoModel: 'vidu::vidu-q1',
      },
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: 'video_panel',
        apiType: 'video',
        model: 'vidu::vidu-q1',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 0,
        action: 'video_panel',
      },
    })).toBe(false)
  })

  it('treats voice-design tasks as local ComfyUI tasks in the current single-path flow', () => {
    expect(taskUsesComfyUiProvider({
      type: 'voice_design',
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: 'voice_design',
        apiType: 'voice-design',
        model: 'comfyui::baseaudio/音色/s2-se',
        quantity: 1,
        unit: 'call',
        maxFrozenCost: 0,
        action: 'voice_design',
      },
    })).toBe(true)
  })
})
