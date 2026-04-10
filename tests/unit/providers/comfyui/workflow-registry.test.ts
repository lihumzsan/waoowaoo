import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadComfyUiWorkflowJsonFile,
  resolveComfyUiWorkflow,
} from '@/lib/providers/comfyui/workflow-registry'

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
          widgets_values: ['default prompt'],
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
      prompt: 'male doctor character prompt',
    })

    expect(graph['235']?.inputs?.value).toBe('male doctor character prompt')
    expect(graph['64']?.inputs?.text).toEqual(['235', 0])
  })

  it('keeps linked prompt widgets aligned for downstream scalar inputs', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseimage/prompt/test-linked-widget-alignment', {
      nodes: [
        {
          id: 103,
          type: 'JjkText',
          inputs: [
            {
              name: 'text',
              type: 'STRING',
              widget: { name: 'text' },
              link: null,
            },
          ],
          outputs: [
            {
              name: 'text',
              type: 'STRING',
              links: [9664],
            },
          ],
          widgets_values: ['default prompt'],
        },
        {
          id: 95,
          type: 'RH_LLMAPI_NODE',
          inputs: [
            {
              name: 'prompt',
              type: 'STRING',
              widget: { name: 'prompt' },
              link: 9664,
            },
            {
              name: 'temperature',
              type: 'FLOAT',
              widget: { name: 'temperature' },
            },
            {
              name: 'seed',
              type: 'INT',
              widget: { name: 'seed' },
            },
          ],
          widgets_values: ['workflow prompt', 0.6, 1789, 'randomize'],
        },
      ],
      links: [
        [9664, 103, 0, 95, 0, 'STRING'],
      ],
    })

    const graph = loadComfyUiWorkflowJsonFile('baseimage/prompt/test-linked-widget-alignment')

    expect(graph?.['95']?.inputs?.prompt).toEqual(['103', 0])
    expect(graph?.['95']?.inputs?.temperature).toBe(0.6)
    expect(graph?.['95']?.inputs?.seed).toBe(1789)
  })

  it('keeps promptLine widgets aligned when prompt comes from a link', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseimage/prompt/test-prompt-line-alignment', {
      nodes: [
        {
          id: 102,
          type: 'ProcessString',
          inputs: [
            {
              name: 'input_string',
              type: 'STRING',
              widget: { name: 'input_string' },
              link: null,
            },
            {
              name: 'option',
              type: 'COMBO',
              widget: { name: 'option' },
            },
          ],
          outputs: [
            {
              name: 'STRING',
              type: 'STRING',
              links: [3744],
            },
          ],
          widgets_values: ['', 'remove-new-lines'],
        },
        {
          id: 76,
          type: 'easy promptLine',
          inputs: [
            {
              name: 'prompt',
              type: 'STRING',
              widget: { name: 'prompt' },
              link: 3744,
            },
            {
              name: 'start_index',
              type: 'INT',
              widget: { name: 'start_index' },
            },
            {
              name: 'max_rows',
              type: 'INT',
              widget: { name: 'max_rows' },
            },
            {
              name: 'remove_empty_lines',
              type: 'BOOLEAN',
              widget: { name: 'remove_empty_lines' },
            },
          ],
          widgets_values: ['Next Scene: one', 0, 1000, true, ''],
        },
      ],
      links: [
        [3744, 102, 0, 76, 0, 'STRING'],
      ],
    })

    const graph = loadComfyUiWorkflowJsonFile('baseimage/prompt/test-prompt-line-alignment')

    expect(graph?.['102']?.inputs?.option).toBe('remove-new-lines')
    expect(graph?.['76']?.inputs?.prompt).toEqual(['102', 0])
    expect(graph?.['76']?.inputs?.start_index).toBe(0)
    expect(graph?.['76']?.inputs?.max_rows).toBe(1000)
    expect(graph?.['76']?.inputs?.remove_empty_lines).toBe(true)
  })

  it('broadcasts Anything Everywhere sources to matching unlinked typed inputs', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseimage/prompt/test-anything-everywhere', {
      nodes: [
        {
          id: 106,
          type: 'UNETLoader',
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [9612] }],
          widgets_values: [],
        },
        {
          id: 107,
          type: 'CLIPLoader',
          outputs: [{ name: 'CLIP', type: 'CLIP', links: [6648] }],
          widgets_values: [],
        },
        {
          id: 110,
          type: 'VAELoader',
          outputs: [{ name: 'VAE', type: 'VAE', links: [6653] }],
          widgets_values: [],
        },
        {
          id: 111,
          type: 'Anything Everywhere',
          inputs: [
            { name: 'anything', type: 'MODEL', link: 9612 },
            { name: 'anything2', type: 'CLIP', link: 6648 },
            { name: 'anything3', type: 'VAE', link: 6653 },
          ],
          widgets_values: [],
        },
        {
          id: 56,
          type: 'KSampler',
          inputs: [
            { name: 'model', type: 'MODEL', link: null },
            { name: 'seed', type: 'INT', widget: { name: 'seed' } },
          ],
          widgets_values: [123],
        },
        {
          id: 61,
          type: 'TextEncodeQwenImageEditPlus',
          inputs: [
            { name: 'clip', type: 'CLIP', link: null },
            { name: 'vae', type: 'VAE', link: null },
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' } },
          ],
          widgets_values: [''],
        },
        {
          id: 69,
          type: 'VAEDecode',
          inputs: [
            { name: 'samples', type: 'LATENT', link: null },
            { name: 'vae', type: 'VAE', link: null },
          ],
          widgets_values: [],
        },
      ],
      links: [
        [9612, 106, 0, 111, 0, 'MODEL'],
        [6648, 107, 0, 111, 1, 'CLIP'],
        [6653, 110, 0, 111, 2, 'VAE'],
      ],
    })

    const graph = loadComfyUiWorkflowJsonFile('baseimage/prompt/test-anything-everywhere')

    expect(graph?.['56']?.inputs?.model).toEqual(['106', 0])
    expect(graph?.['61']?.inputs?.clip).toEqual(['107', 0])
    expect(graph?.['61']?.inputs?.vae).toEqual(['110', 0])
    expect(graph?.['69']?.inputs?.vae).toEqual(['110', 0])
  })

  it('injects prompt into connected text nodes when prompt field is linked', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseimage/prompt/test-connected-text-source', {
      nodes: [
        {
          id: 103,
          type: 'JjkText',
          inputs: [
            {
              name: 'text',
              type: 'STRING',
              widget: { name: 'text' },
              link: null,
            },
          ],
          outputs: [
            {
              name: 'text',
              type: 'STRING',
              links: [9664],
            },
          ],
          widgets_values: ['old prompt'],
        },
        {
          id: 95,
          type: 'RH_LLMAPI_NODE',
          inputs: [
            {
              name: 'prompt',
              type: 'STRING',
              widget: { name: 'prompt' },
              link: 9664,
            },
            {
              name: 'temperature',
              type: 'FLOAT',
              widget: { name: 'temperature' },
            },
          ],
          widgets_values: ['workflow prompt', 0.6],
        },
      ],
      links: [
        [9664, 103, 0, 95, 0, 'STRING'],
      ],
    })

    const graph = resolveComfyUiWorkflow('baseimage/prompt/test-connected-text-source', {
      prompt: 'fresh storyboard prompt',
    })

    expect(graph['103']?.inputs?.text).toBe('fresh storyboard prompt')
    expect(graph['95']?.inputs?.prompt).toEqual(['103', 0])
    expect(graph['95']?.inputs?.temperature).toBe(0.6)
  })

  it('randomizes seed fields within the safe 31-bit int range', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseaudio/prompt/test-safe-seed-range', {
      nodes: [
        {
          id: 29,
          type: 'FishS2TTS',
          inputs: [
            {
              name: 'seed',
              type: 'INT',
              widget: { name: 'seed' },
              link: null,
            },
            {
              name: 'noise_seed',
              type: 'INT',
              widget: { name: 'noise_seed' },
              link: null,
            },
          ],
          widgets_values: [1732351807, 'randomize', 9988, 'randomize'],
        },
      ],
      links: [],
    })

    const graph = resolveComfyUiWorkflow('baseaudio/prompt/test-safe-seed-range')
    const seed = graph['29']?.inputs?.seed
    const noiseSeed = graph['29']?.inputs?.noise_seed

    expect(typeof seed).toBe('number')
    expect(typeof noiseSeed).toBe('number')
    expect(Number.isInteger(seed)).toBe(true)
    expect(Number.isInteger(noiseSeed)).toBe(true)
    expect(Number(seed)).toBeGreaterThanOrEqual(0)
    expect(Number(seed)).toBeLessThanOrEqual(2_147_483_647)
    expect(Number(noiseSeed)).toBeGreaterThanOrEqual(0)
    expect(Number(noiseSeed)).toBeLessThanOrEqual(2_147_483_647)
  })

  it('sanitizes save-node filename prefixes into Windows-safe paths', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseaudio/prompt/test-save-prefix-sanitize', {
      nodes: [
        {
          id: 31,
          type: 'SaveAudio',
          inputs: [
            {
              name: 'filename_prefix',
              type: 'STRING',
              widget: { name: 'filename_prefix' },
              link: null,
            },
          ],
          widgets_values: ['%date:yyyy-MM-dd%/VX-paolaoshiAICG_'],
        },
      ],
      links: [],
    })

    const graph = resolveComfyUiWorkflow('baseaudio/prompt/test-save-prefix-sanitize')
    const filenamePrefix = graph['31']?.inputs?.filename_prefix

    expect(typeof filenamePrefix).toBe('string')
    expect(String(filenamePrefix)).toContain('/VX-paolaoshiAICG_')
    expect(String(filenamePrefix)).not.toContain(':')
  })

  it('injects uploaded audio filenames into LoadAudio nodes for local voice workflows', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseaudio/prompt/test-audio-injection', {
      nodes: [
        {
          id: 6,
          type: 'LoadAudio',
          inputs: [
            {
              name: 'audio',
              type: 'COMBO',
              widget: { name: 'audio' },
              link: null,
            },
            {
              name: 'audioUI',
              type: 'AUDIO_UI',
              widget: { name: 'audioUI' },
              link: null,
            },
            {
              name: 'upload',
              type: 'AUDIOUPLOAD',
              widget: { name: 'upload' },
              link: null,
            },
          ],
          widgets_values: ['demo.wav', null, null],
        },
      ],
      links: [],
    })

    const graph = resolveComfyUiWorkflow('baseaudio/prompt/test-audio-injection', {
      audioFilenames: ['voice-ref.wav'],
    })

    expect(graph['6']?.inputs?.audio).toBe('voice-ref.wav')
    expect(Object.prototype.hasOwnProperty.call(graph['6']?.inputs ?? {}, 'audioUI')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(graph['6']?.inputs ?? {}, 'upload')).toBe(false)
  })

  it('injects fps and frame count into connected temporal constant nodes', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-temporal-injection', {
      nodes: [
        {
          id: 23,
          type: 'FloatConstant',
          inputs: [
            {
              name: 'value',
              type: 'FLOAT',
              widget: { name: 'value' },
              link: null,
            },
          ],
          outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [101] }],
          widgets_values: [25],
        },
        {
          id: 27,
          type: 'INTConstant',
          inputs: [
            {
              name: 'value',
              type: 'INT',
              widget: { name: 'value' },
              link: null,
            },
          ],
          outputs: [{ name: 'INT', type: 'INT', links: [102] }],
          widgets_values: [105],
        },
        {
          id: 22,
          type: 'LTXVConditioning',
          inputs: [
            { name: 'frame_rate', type: 'FLOAT', link: 101 },
          ],
          widgets_values: [''],
        },
        {
          id: 43,
          type: 'EmptyLTXVLatentVideo',
          inputs: [
            { name: 'length', type: 'INT', link: 102 },
          ],
          widgets_values: [''],
        },
      ],
      links: [
        [101, 23, 0, 22, 0, 'FLOAT'],
        [102, 27, 0, 43, 0, 'INT'],
      ],
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-temporal-injection', {
      fps: 24,
      targetFrameCount: 144,
    })

    expect(graph['23']?.inputs?.value).toBe(24)
    expect(graph['27']?.inputs?.value).toBe(144)
    expect(graph['22']?.inputs?.frame_rate).toEqual(['23', 0])
    expect(graph['43']?.inputs?.length).toEqual(['27', 0])
  })

  it('reads widget values stored as keyed objects for VHS video workflows', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-vhs-widget-object', {
      nodes: [
        {
          id: 23,
          type: 'FloatConstant',
          inputs: [
            {
              name: 'value',
              type: 'FLOAT',
              widget: { name: 'value' },
              link: null,
            },
          ],
          outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [127] }],
          widgets_values: [25],
        },
        {
          id: 40,
          type: 'VHS_VideoCombine',
          inputs: [
            { name: 'images', type: 'IMAGE', link: 50 },
            { name: 'audio', type: 'AUDIO', link: 51 },
            {
              name: 'frame_rate',
              type: 'FLOAT',
              widget: { name: 'frame_rate' },
              link: 127,
            },
            {
              name: 'loop_count',
              type: 'INT',
              widget: { name: 'loop_count' },
            },
            {
              name: 'filename_prefix',
              type: 'STRING',
              widget: { name: 'filename_prefix' },
            },
            {
              name: 'format',
              type: 'COMBO',
              widget: { name: 'format' },
            },
            {
              name: 'pingpong',
              type: 'BOOLEAN',
              widget: { name: 'pingpong' },
            },
            {
              name: 'save_output',
              type: 'BOOLEAN',
              widget: { name: 'save_output' },
            },
          ],
          widgets_values: {
            frame_rate: 32,
            loop_count: 0,
            filename_prefix: 'ltx/AnimateDiff',
            format: 'video/h264-mp4',
            pingpong: false,
            save_output: true,
          },
        },
      ],
      links: [
        [127, 23, 0, 40, 2, 'FLOAT'],
      ],
    })

    const graph = loadComfyUiWorkflowJsonFile('basevideo/prompt/test-vhs-widget-object')

    expect(graph?.['40']?.inputs?.frame_rate).toEqual(['23', 0])
    expect(graph?.['40']?.inputs?.loop_count).toBe(0)
    expect(graph?.['40']?.inputs?.filename_prefix).toBe('ltx/AnimateDiff')
    expect(graph?.['40']?.inputs?.format).toBe('video/h264-mp4')
    expect(graph?.['40']?.inputs?.pingpong).toBe(false)
    expect(graph?.['40']?.inputs?.save_output).toBe(true)
  })
})
