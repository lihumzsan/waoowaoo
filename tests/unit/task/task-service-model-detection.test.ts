import { describe, expect, it } from 'vitest'
import { extractTaskModelKeys, taskUsesComfyUiProvider } from '@/lib/task/service'

describe('task service model detection', () => {
  it('detects ComfyUI tasks from billing model keys', () => {
    expect(taskUsesComfyUiProvider({
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: 'video_panel',
        apiType: 'video',
        model: 'comfyui::basevideo/图生视频/ltx2.3-图生视频-没字幕版',
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
        videoModel: 'ark::doubao-seedance-2-0-fast-260128',
        firstLastFrame: {
          flModel: 'comfyui::basevideo/首尾帧/ltx2.3首尾帧',
        },
      },
    })).toEqual([
      'ark::doubao-seedance-2-0-fast-260128',
      'comfyui::basevideo/首尾帧/ltx2.3首尾帧',
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
        model: 'bailian-voice-design',
        quantity: 1,
        unit: 'call',
        maxFrozenCost: 0,
        action: 'voice_design',
      },
    })).toBe(true)
  })
})
