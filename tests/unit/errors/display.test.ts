import { describe, expect, it } from 'vitest'
import { resolveErrorDisplay } from '@/lib/errors/display'

describe('resolveErrorDisplay', () => {
  it('surfaces missing ComfyUI workflow as a missing config message', () => {
    const result = resolveErrorDisplay({
      code: 'INTERNAL_ERROR',
      message: 'COMFYUI_WORKFLOW_NOT_FOUND: baseimage/图片生成/Flux2Klein文生图',
    })

    expect(result).toEqual({
      code: 'MISSING_CONFIG',
      message: '未找到本地 ComfyUI 工作流。请检查 COMFYUI_WORKFLOW_ROOT 或工作流目录。缺少工作流：baseimage/图片生成/Flux2Klein文生图.json',
    })
  })
})
