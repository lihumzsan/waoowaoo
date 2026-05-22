import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  comfyUiWorkflowRequiresLlmApi,
  getComfyUiWorkflowParameterContract,
  getComfyUiWorkflowImageInputCount,
  listComfyUiWorkflowKeys,
  resolveComfyUiWorkflow,
  validateResolvedWorkflowPreflight,
} from '@/lib/providers/comfyui/workflow-registry'

function getLoadImageNodes(workflow: ReturnType<typeof resolveComfyUiWorkflow>) {
  return Object.values(workflow).filter((node) => node.class_type.toLowerCase().includes('loadimage'))
}

describe('comfyui workflow registry', () => {
  let workflowRoot: string | null = null

  afterEach(() => {
    delete process.env.COMFYUI_WORKFLOW_ROOT
    if (workflowRoot) {
      rmSync(workflowRoot, { recursive: true, force: true })
      workflowRoot = null
    }
  })

  function writeExternalWorkflow(workflowKey: string, workflow: unknown) {
    workflowRoot = workflowRoot || mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-workflow-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    const filePath = join(workflowRoot, `${workflowKey}.json`.replace(/\//g, '\\'))
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(workflow), 'utf-8')
  }

  it('detects and injects OpenRouter config into RH LLM API nodes', () => {
    writeExternalWorkflow('basevideo/test/rh-llm', {
      '1': {
        class_type: 'RH_LLMAPI_NODE',
        inputs: {
          api_baseurl: '__COMFYUI_LLM_BASE_URL__',
          api_key: '__COMFYUI_LLM_API_KEY__',
          model: '__COMFYUI_LLM_MODEL__',
          prompt: 'rewrite prompt',
        },
      },
    })

    expect(comfyUiWorkflowRequiresLlmApi('basevideo/test/rh-llm')).toBe(true)

    const workflow = resolveComfyUiWorkflow('basevideo/test/rh-llm', {
      llmApi: {
        baseUrl: 'https://openrouter.ai/api/v1/',
        apiKey: 'or-test-key',
        model: 'openrouter/test-model',
      },
    })

    expect(workflow['1']?.inputs.api_baseurl).toBe('https://openrouter.ai/api/v1')
    expect(workflow['1']?.inputs.api_key).toBe('or-test-key')
    expect(workflow['1']?.inputs.model).toBe('openrouter/test-model')
  })

  it('fails fast when an RH LLM API workflow is resolved without an OpenRouter config', () => {
    writeExternalWorkflow('basevideo/test/rh-llm-missing-config', {
      '1': {
        class_type: 'RH_LLMAPI_NODE',
        inputs: {
          api_baseurl: '__COMFYUI_LLM_BASE_URL__',
          api_key: '__COMFYUI_LLM_API_KEY__',
          model: '__COMFYUI_LLM_MODEL__',
        },
      },
    })

    expect(() => resolveComfyUiWorkflow('basevideo/test/rh-llm-missing-config')).toThrow(
      'COMFYUI_LLM_MODEL_NOT_CONFIGURED',
    )
  })

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
      llmApi: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'or-test-key',
        model: 'openrouter/test-model',
      },
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

  it('locks Qwen storyboard workflow parameters before submit', () => {
    const workflowKey = listComfyUiWorkflowKeys().find((key) =>
      key.includes('baseimage/')
      && key.includes('Qwen')
    )

    expect(workflowKey).toBeTruthy()
    expect(getComfyUiWorkflowParameterContract(workflowKey!)).toEqual(expect.objectContaining({
      allowInternalLlmExpansion: false,
      finalOutputNodeIds: ['105'],
    }))

    const workflow = resolveComfyUiWorkflow(workflowKey!, {
      prompt: 'locked current panel prompt',
      negativePrompt: 'locked negative prompt',
      width: 1280,
      height: 720,
      imageFilenames: ['reference.jpg'],
      llmApi: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'or-test-key',
        model: 'openrouter/test-model',
      },
    })

    const result = validateResolvedWorkflowPreflight(workflowKey!, workflow, {
      prompt: 'locked current panel prompt',
      negativePrompt: 'locked negative prompt',
      width: 1280,
      height: 720,
      imageFilenames: ['reference.jpg'],
      llmApi: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'or-test-key',
        model: 'openrouter/test-model',
      },
    }, { expect: 'image' })

    expect(result.ok).toBe(true)
    expect(workflow['68']?.inputs.prompt).toBe('locked current panel prompt')
    expect(workflow['61']?.inputs.prompt).toBe('locked negative prompt')
    expect(workflow['105']?.class_type).toBe('SaveImage')
  })

  it('rejects Qwen storyboard workflows when internal LLM rewrite drives final conditioning', () => {
    const workflowKey = listComfyUiWorkflowKeys().find((key) =>
      key.includes('baseimage/')
      && key.includes('Qwen')
    )

    expect(workflowKey).toBeTruthy()

    const workflow = resolveComfyUiWorkflow(workflowKey!, {
      prompt: 'locked current panel prompt',
      width: 1280,
      height: 720,
      imageFilenames: ['reference.jpg'],
      llmApi: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'or-test-key',
        model: 'openrouter/test-model',
      },
    })
    workflow['68']!.inputs.prompt = ['76', 0]

    expect(() => validateResolvedWorkflowPreflight(workflowKey!, workflow, {
      prompt: 'locked current panel prompt',
      width: 1280,
      height: 720,
      imageFilenames: ['reference.jpg'],
      llmApi: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'or-test-key',
        model: 'openrouter/test-model',
      },
    }, { expect: 'image' })).toThrow('COMFYUI_PREFLIGHT_LLM_REWRITE_LEAK')
  })

  it('duplicates the last provided reference into every remaining LoadImage slot', () => {
    const workflowKey = 'baseimage/图片编辑/qwen双图编辑'
    expect(getComfyUiWorkflowImageInputCount(workflowKey)).toBeGreaterThan(1)

    const workflow = resolveComfyUiWorkflow(workflowKey, {
      prompt: 'single reference edit',
      width: 1280,
      height: 720,
      imageFilenames: ['only-reference.png'],
    })

    const loadImageNodes = getLoadImageNodes(workflow)
    expect(loadImageNodes.length).toBeGreaterThan(1)
    expect(loadImageNodes.every((node) => node.inputs.image === 'only-reference.png')).toBe(true)
    expect(loadImageNodes.every((node) => !Object.prototype.hasOwnProperty.call(node.inputs, 'upload'))).toBe(true)
    expect(loadImageNodes.every((node) => !Object.prototype.hasOwnProperty.call(node.inputs, 'imageUI'))).toBe(true)
    expect(loadImageNodes.every((node) => !Object.prototype.hasOwnProperty.call(node.inputs, 'imageui'))).toBe(true)
  })

  it('removes bundled demo image inputs when no reference image is injected', () => {
    const workflow = resolveComfyUiWorkflow('baseimage/图片编辑/qwen双图编辑', {
      prompt: 'text only edit should not inherit bundled demo images',
      width: 1280,
      height: 720,
    })

    const loadImageNodes = getLoadImageNodes(workflow)
    expect(loadImageNodes.length).toBeGreaterThan(1)
    expect(loadImageNodes.every((node) => !Object.prototype.hasOwnProperty.call(node.inputs, 'image'))).toBe(true)
    expect(loadImageNodes.every((node) => !Object.prototype.hasOwnProperty.call(node.inputs, 'upload'))).toBe(true)
  })

  it('keeps S2 voice-clone reference transcription prompt separate from render text', () => {
    const workflowKey = listComfyUiWorkflowKeys().find((key) => key.endsWith('/s2-one'))
    expect(workflowKey).toBeTruthy()

    const workflow = resolveComfyUiWorkflow(workflowKey!, {
      prompt: '[中年男声][冷静] 可以。',
      audioFilenames: ['reference.wav'],
    })

    const ttsNode = Object.values(workflow).find((node) => node.class_type === 'FishS2VoiceCloneTTS')
    expect(ttsNode?.inputs.text).toEqual(['33', 0])
    expect(workflow['33']?.inputs.text).toBe('[中年男声][冷静] 可以。')
    expect(workflow['37']?.class_type).toBe('Apply Whisper')
    expect(workflow['37']?.inputs.prompt).toBe('')
  })
})
