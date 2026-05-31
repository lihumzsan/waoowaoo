import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_WORKFLOW_KEYS,
  getLtx23WorkflowProfiles,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
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

function getLoadAudioNodes(workflow: ReturnType<typeof resolveComfyUiWorkflow>) {
  return Object.values(workflow).filter((node) => node.class_type.toLowerCase().includes('loadaudio'))
}

function getPromptRelayNodes(workflow: ReturnType<typeof resolveComfyUiWorkflow>) {
  return Object.values(workflow).filter((node) => node.class_type.toLowerCase().includes('promptrelay'))
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
    const filePath = join(workflowRoot, `${workflowKey}.json`)
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

  it('rejects Qwen storyboard workflows when final conditioning is not locked', () => {
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
    }, { expect: 'image' })).toThrow('COMFYUI_PREFLIGHT_PROMPT_NOT_LOCKED')
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

  it('locks LTX2.3 profile duration and PromptRelay controls into resolved workflows', () => {
    const largeMotion = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion, {
      prompt: 'GLOBAL: office\nLOCAL: doctor speaks',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 16,
      targetFrameCount: 400,
    })
    expect(largeMotion['1332']?.inputs.length).toBe(400)
    const largeMotionRelay = getPromptRelayNodes(largeMotion)[0]
    expect(largeMotionRelay?.inputs.global_prompt).toBe('office')
    expect(String(largeMotionRelay?.inputs.local_prompts)).toContain('doctor speaks')
    expect(String(largeMotionRelay?.inputs.local_prompts)).toContain('Stage 4')
    expect(largeMotionRelay?.inputs.segment_lengths).toBe('100, 100, 100, 100')
    const largeMotionTimeline = JSON.parse(String(largeMotionRelay?.inputs.timeline_data)) as {
      segments: Array<{ prompt: string; length: number }>
    }
    expect(largeMotionTimeline.segments.map((segment) => segment.length)).toEqual([100, 100, 100, 100])
    expect(largeMotionTimeline.segments[0]?.prompt).toContain('Stage 1')
    expect(largeMotionTimeline.segments[3]?.prompt).toContain('Stage 4')
    expect(JSON.stringify(largeMotionTimeline)).not.toContain('年轻的女人')

    const numberedLocalSections = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion, {
      prompt: [
        'GLOBAL: office with the same doctor',
        'LOCAL 1: doctor inhales',
        'LOCAL 2: doctor speaks',
        'LOCAL 3: doctor pauses',
        'LOCAL 4: doctor settles',
      ].join('\n'),
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 16,
      targetFrameCount: 400,
    })
    const numberedRelay = getPromptRelayNodes(numberedLocalSections)[0]
    expect(String(numberedRelay?.inputs.global_prompt)).toContain('office with the same doctor')
    expect(String(numberedRelay?.inputs.local_prompts)).toContain('doctor inhales')
    expect(String(numberedRelay?.inputs.local_prompts)).toContain('doctor speaks')
    expect(String(numberedRelay?.inputs.local_prompts)).toContain('doctor pauses')
    expect(String(numberedRelay?.inputs.local_prompts)).toContain('doctor settles')

    const slowPushIn = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion, {
      prompt: 'GLOBAL: office\nLOCAL: \u955c\u5934\u7f13\u6162\u63a8\u8fdb\uff0c\u4fdd\u6301\u4e24\u4eba\u548c\u4e66\u684c\u6784\u56fe\u7a33\u5b9a',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 12,
      targetFrameCount: 300,
    })
    const slowPushInRelay = getPromptRelayNodes(slowPushIn)[0]
    expect(slowPushInRelay?.inputs.segment_lengths).toBe('75, 75, 75, 75')
    expect(String(slowPushInRelay?.inputs.local_prompts)).toContain('Stage 3: maintain the same slow restrained push-in speed')
    expect(String(slowPushInRelay?.inputs.local_prompts)).not.toContain('strongest continuous movement')

    const enhancedSlowPushIn = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion, {
      prompt: 'GLOBAL: office\nLOCAL: 12\u79d2\u5355\u955c\u5934\u8fde\u7eed\u63a8\u8fdb\u7d27\u5f20\u611f\uff0c\u53ea\u4fdd\u7559\u6781\u8f7b\u5fae\u7684\u7a33\u5b9a\u5185\u538b\u8282\u594f',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 12,
      targetFrameCount: 300,
    })
    const enhancedSlowPushInRelay = getPromptRelayNodes(enhancedSlowPushIn)[0]
    expect(String(enhancedSlowPushInRelay?.inputs.local_prompts)).toContain('Stage 3: maintain the same slow restrained push-in speed')
    expect(String(enhancedSlowPushInRelay?.inputs.local_prompts)).not.toContain('strongest continuous movement')

    const stabilizedEnhancedPrompt = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion, {
      prompt: 'GLOBAL: office\nLOCAL: \u4fdd\u6301\u6e90\u56fe\u7684\u4fef\u62cd\u8fdc\u666f\u4e0e\u7a33\u5b9a\u6784\u56fe\uff0c12\u79d2\u5355\u955c\u5934\u8fde\u7eed\u52a8\u4f5c\u53ea\u4fdd\u7559\u514b\u5236\u7684\u547c\u5438\u3001\u8f7b\u5fae\u7728\u773c\u548c\u6781\u7ec6\u5c0f\u7684\u59ff\u6001\u53d8\u5316',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 12,
      targetFrameCount: 300,
    })
    const stabilizedRelay = getPromptRelayNodes(stabilizedEnhancedPrompt)[0]
    expect(String(stabilizedRelay?.inputs.local_prompts)).toContain('Stage 3: maintain the same slow restrained push-in speed')
    expect(String(stabilizedRelay?.inputs.local_prompts)).not.toContain('strongest continuous movement')

    const barelyVisiblePushIn = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion, {
      prompt: 'GLOBAL: office\nLOCAL: \u955c\u5934\u5168\u7a0b\u7a33\u5b9a\uff0c\u4ec5\u5728\u539f\u6709\u6784\u56fe\u5185\u505a\u51e0\u4e4e\u4e0d\u53ef\u5bdf\u89c9\u7684\u7f13\u6162\u538b\u8fd1\uff0c\u52a8\u4f5c\u81ea\u7136\u8fde\u8d2f',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 12,
      targetFrameCount: 300,
    })
    const barelyVisibleRelay = getPromptRelayNodes(barelyVisiblePushIn)[0]
    expect(String(barelyVisibleRelay?.inputs.local_prompts)).toContain('Stage 3: maintain the same slow restrained push-in speed')
    expect(String(barelyVisibleRelay?.inputs.local_prompts)).not.toContain('strongest continuous movement')

    const damaicha30s = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s, {
      prompt: 'GLOBAL: office\nLOCAL: doctor speaks',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 20,
      targetFrameCount: 500,
    })
    expect(damaicha30s['158']?.inputs.a).toBe(20)

    const damaichaPromptRelay = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay, {
      prompt: 'GLOBAL: office\nLOCAL: doctor speaks',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 20,
      targetFrameCount: 500,
    })
    expect(damaichaPromptRelay['361']?.inputs.value).toBe(20)
    const damaichaRelay = getPromptRelayNodes(damaichaPromptRelay)[0]
    expect(damaichaRelay?.inputs.segment_lengths).toBe('100, 100, 100, 100, 100')
    expect(String(damaichaRelay?.inputs.timeline_data)).not.toContain('年轻女性身穿浅灰色针织衫')

    const aio = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2, {
      prompt: 'GLOBAL: office\nLOCAL: doctor speaks',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 8,
      targetFrameCount: 200,
    })
    expect(aio['472']?.inputs.value).toBe(8)
    expect(getPromptRelayNodes(aio)[0]?.inputs.segment_lengths).toBe('67, 67, 66')
  })

  it('keeps bundled LoadAudio placeholders for LTX2.3 workflows when no audio is injected', () => {
    for (const profile of getLtx23WorkflowProfiles()) {
      const workflow = resolveComfyUiWorkflow(profile.workflowKey, {
        prompt: 'quiet shot',
        imageFilenames: ['source.png'],
        fps: profile.fps,
        durationSeconds: profile.defaultDurationSeconds,
      })
      const loadAudioNodes = getLoadAudioNodes(workflow)
      for (const node of loadAudioNodes) {
        expect(node.inputs.audio).toEqual(expect.any(String))
        expect(String(node.inputs.audio).trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('drops dangling LTX2.3 video output nodes before ComfyUI validation', () => {
    const workflow = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.microDetail, {
      prompt: 'quiet shot',
      imageFilenames: ['source.png'],
      fps: 25,
      durationSeconds: 4,
    })

    const videoOutputs = Object.values(workflow).filter((node) =>
      node.class_type === 'VHS_VideoCombine'
    )

    expect(videoOutputs.length).toBeGreaterThan(0)
    expect(videoOutputs.every((node) => Object.prototype.hasOwnProperty.call(node.inputs, 'images'))).toBe(true)
  })

  it('locks PromptRelaySmartEncode global and smart prompts for updated single-image workflows', () => {
    for (const workflowKey of [
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
      COMFYUI_LTX23_WORKFLOW_KEYS.microDetail,
    ]) {
      const workflow = resolveComfyUiWorkflow(workflowKey, {
        prompt: 'GLOBAL: office scene\nLOCAL: doctor raises glasses',
        imageFilenames: ['source.png'],
        audioFilenames: ['silence.wav'],
        fps: 25,
        durationSeconds: 6,
        targetFrameCount: 150,
      })

      const relay = getPromptRelayNodes(workflow).find((node) => node.class_type === 'PromptRelaySmartEncode')
      expect(relay).toBeTruthy()

      const globalPromptSourceId = Array.isArray(relay?.inputs.global_prompt)
        ? String(relay.inputs.global_prompt[0])
        : ''
      const smartPromptSourceId = Array.isArray(relay?.inputs.smart_prompt)
        ? String(relay.inputs.smart_prompt[0])
        : ''

      expect(workflow[globalPromptSourceId]?.inputs.prompt).toBe('office scene')
      expect(workflow[smartPromptSourceId]?.inputs.prompt).toBe(
        'doctor raises glasses [0-38] | doctor raises glasses [38-76] | doctor raises glasses [76-113] | doctor raises glasses [113-150]',
      )
    }
  })

  it('splits same-line GLOBAL and LOCAL sections for PromptRelaySmartEncode workflows', () => {
    const workflow = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise, {
      prompt: 'GLOBAL: office scene with two men at a desk. LOCAL: the doctor leans forward and speaks calmly.',
      imageFilenames: ['source.png'],
      audioFilenames: ['silence.wav'],
      fps: 25,
      durationSeconds: 6,
      targetFrameCount: 150,
    })

    const relay = getPromptRelayNodes(workflow).find((node) => node.class_type === 'PromptRelaySmartEncode')
    expect(relay).toBeTruthy()

    const globalPromptSourceId = Array.isArray(relay?.inputs.global_prompt)
      ? String(relay.inputs.global_prompt[0])
      : ''
    const smartPromptSourceId = Array.isArray(relay?.inputs.smart_prompt)
      ? String(relay.inputs.smart_prompt[0])
      : ''

    expect(workflow[globalPromptSourceId]?.inputs.prompt).toBe('office scene with two men at a desk.')
    expect(workflow[smartPromptSourceId]?.inputs.prompt).toBe(
      'the doctor leans forward and speaks calmly. [0-38] | the doctor leans forward and speaks calmly. [38-76] | the doctor leans forward and speaks calmly. [76-113] | the doctor leans forward and speaks calmly. [113-150]',
    )
  })

  it('drops disabled video outputs when an active video output remains', () => {
    const workflow = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay, {
      prompt: 'quiet shot',
      imageFilenames: ['source.png'],
      audioFilenames: ['silence.wav'],
      fps: 25,
      durationSeconds: 12,
      targetFrameCount: 300,
    })

    const videoOutputs = Object.entries(workflow)
      .filter(([, node]) => node.class_type === 'VHS_VideoCombine')
      .map(([nodeId, node]) => ({ nodeId, saveOutput: node.inputs.save_output }))

    expect(videoOutputs).toEqual([{ nodeId: '280', saveOutput: true }])
  })
})
