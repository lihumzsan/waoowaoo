import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveComfyUiWorkflow } from '@/lib/providers/comfyui/workflow-registry'

function createWorkflowRoot() {
  return mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-'))
}

function writeWorkflow(root: string, workflowKey: string, workflow: unknown) {
  const relativePath = `${workflowKey}.json`.replace(/\//g, '\\')
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(workflow), 'utf-8')
}

describe('comfyui workflow registry prompt injection', () => {
  let workflowRoot: string | null = null

  afterEach(() => {
    delete process.env.COMFYUI_WORKFLOW_ROOT
    if (workflowRoot) {
      rmSync(workflowRoot, { recursive: true, force: true })
      workflowRoot = null
    }
  })

  it('injects prompt into connected PrimitiveStringMultiline value nodes', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseimage/prompt/test-character', {
      nodes: [
        {
          id: 235,
          type: 'PrimitiveStringMultiline',
          inputs: [
            {
              name: 'value',
              type: 'STRING',
              widget: { name: 'value' },
              link: null,
            },
          ],
          widgets_values: ['默认美女提示词'],
        },
        {
          id: 64,
          type: 'CLIPTextEncode',
          inputs: [
            {
              name: 'text',
              type: 'STRING',
              widget: { name: 'text' },
              link: 351,
            },
          ],
          widgets_values: [''],
        },
      ],
      links: [
        [351, 235, 0, 64, 1, 'STRING'],
      ],
    })

    const graph = resolveComfyUiWorkflow('baseimage/prompt/test-character', {
      prompt: '中国男性，中年医生，黑色短发，白色医师袍',
    })

    expect(graph['235']?.inputs?.value).toBe('中国男性，中年医生，黑色短发，白色医师袍')
    expect(graph['64']?.inputs?.text).toEqual(['235', 0])
  })
})
