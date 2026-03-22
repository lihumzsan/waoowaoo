import { describe, expect, it } from 'vitest'
import {
  assertSafeComfyUiWorkflowFileKey,
  COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID,
  loadComfyUiWorkflowJsonFile,
} from '@/lib/providers/comfyui/workflow-registry'

describe('provider contract - comfyui workflow registry', () => {
  it('rejects unsafe workflow keys', () => {
    expect(assertSafeComfyUiWorkflowFileKey('qwen-image-txt2img')).toBe('qwen-image-txt2img')
    expect(() => assertSafeComfyUiWorkflowFileKey('../evil')).toThrow()
  })

  it('loads bundled default image workflow graph', () => {
    expect(COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID).toBe('qwen-image-txt2img')
    const graph = loadComfyUiWorkflowJsonFile(COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID)
    expect(graph).toBeTruthy()
    expect(typeof graph).toBe('object')
  })
})
