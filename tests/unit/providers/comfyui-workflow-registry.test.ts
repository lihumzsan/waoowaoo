import { describe, expect, it } from 'vitest'
import { listComfyUiWorkflowKeys, resolveComfyUiWorkflow } from '@/lib/providers/comfyui/workflow-registry'

describe('comfyui workflow registry', () => {
  it('applies target aspect ratio and longest side to Qwen storyboard resize nodes', () => {
    const workflowKey = listComfyUiWorkflowKeys().find((key) =>
      key.includes('baseimage/')
      && key.includes('Qwen')
    )

    expect(workflowKey).toBeTruthy()

    const workflow = resolveComfyUiWorkflow(workflowKey!, {
      prompt: 'dimension test',
      width: 1280,
      height: 720,
      imageFilenames: ['reference.jpg'],
    })

    const resizeNode = Object.values(workflow).find((node) =>
      Object.prototype.hasOwnProperty.call(node.inputs, 'aspect_ratio')
      && Object.prototype.hasOwnProperty.call(node.inputs, 'scale_to_length')
    )
    expect(resizeNode?.inputs.aspect_ratio).toBe('16:9')

    const scaleToLength = resizeNode?.inputs.scale_to_length
    expect(Array.isArray(scaleToLength)).toBe(true)
    const intNodeId = Array.isArray(scaleToLength) ? String(scaleToLength[0]) : ''
    expect(workflow[intNodeId]?.inputs.value).toBe(1280)
  })
})
