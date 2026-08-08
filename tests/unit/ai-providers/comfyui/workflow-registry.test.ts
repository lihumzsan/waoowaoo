import { describe, expect, it } from 'vitest'
import { assertSafeComfyUiWorkflowFileKey } from '@/lib/ai-providers/comfyui/workflow-registry'

describe('ComfyUI workflow registry', () => {
  it('accepts a normalized workflow key and rejects path traversal', () => {
    expect(assertSafeComfyUiWorkflowFileKey('basevideo/seedance2/bernini-480p-i2v')).toBe('basevideo/seedance2/bernini-480p-i2v')
    expect(() => assertSafeComfyUiWorkflowFileKey('../secret')).toThrow('COMFYUI_WORKFLOW_KEY_INVALID')
  })
})
