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
  const relativePath = `${workflowKey}.json`
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(workflow), 'utf-8')
}

const TEST_LLM_API = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-test-openrouter',
  model: 'openrouter/test-model',
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

  it('repeats a single image across all four LTX2.3 large-motion image slots', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage', {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-1.png', upload: 'image' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'old-2.png', upload: 'image' } },
      '3': { class_type: 'LoadImage', inputs: { image: 'old-3.png', upload: 'image' } },
      '4': { class_type: 'LoadImage', inputs: { image: 'old-4.png', upload: 'image' } },
    })

    const graph = resolveComfyUiWorkflow('basevideo/ltx23-profiles/t8-single-image-large-motion-4stage', {
      imageFilenames: ['source.png'],
    })

    expect(graph['1']?.inputs?.image).toBe('source.png')
    expect(graph['2']?.inputs?.image).toBe('source.png')
    expect(graph['3']?.inputs?.image).toBe('source.png')
    expect(graph['4']?.inputs?.image).toBe('source.png')
  })

  it('uses the final filename as the last-frame image for LTX2.3 first-last slots', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/ltx23-profiles/t8-smooth-first-last-frame', {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-first.png', upload: 'image' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'old-middle.png', upload: 'image' } },
      '3': { class_type: 'LoadImage', inputs: { image: 'old-last.png', upload: 'image' } },
    })

    const graph = resolveComfyUiWorkflow('basevideo/ltx23-profiles/t8-smooth-first-last-frame', {
      imageFilenames: ['first.png', 'reference.png', 'last.png'],
    })

    expect(graph['1']?.inputs?.image).toBe('first.png')
    expect(graph['2']?.inputs?.image).toBe('last.png')
    expect(graph['3']?.inputs?.image).toBe('last.png')
  })

  it('prefers the latest ui nodes over stale embedded extra.prompt snapshots', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-ignore-stale-extra-prompt', {
      nodes: [
        {
          id: 1,
          type: 'CheckpointLoaderSimple',
          inputs: [
            {
              name: 'ckpt_name',
              type: 'COMBO',
              widget: { name: 'ckpt_name' },
              link: null,
            },
          ],
          widgets_values: ['ltx\\ltx-2.3-22b-dev-fp8.safetensors'],
        },
        {
          id: 28,
          type: 'LTXVConcatAVLatent',
          inputs: [
            { name: 'model', type: 'MODEL', link: 101 },
          ],
          widgets_values: [],
        },
      ],
      links: [
        [101, 1, 0, 28, 0, 'MODEL'],
      ],
      extra: {
        prompt: {
          '1': {
            class_type: 'CheckpointLoaderSimple',
            inputs: {
              ckpt_name: 'legacy-bad-checkpoint.safetensors',
            },
          },
          '44': {
            class_type: 'LTXVSequenceParallelMultiGPUPatcher',
            inputs: {
              model: ['1', 0],
            },
          },
          '28': {
            class_type: 'LTXVConcatAVLatent',
            inputs: {
              model: ['44', 0],
            },
          },
        },
      },
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-ignore-stale-extra-prompt')

    expect(graph['1']?.inputs?.ckpt_name).toBe('ltx\\ltx-2.3-22b-dev-fp8.safetensors')
    expect(graph['44']).toBeUndefined()
    expect(graph['28']?.inputs?.model).toEqual(['1', 0])
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

  it('feeds app prompts directly into Qwen image encoders and strips text-only output nodes', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseimage/prompt/test-qwen-storyboard-direct-prompt', {
      nodes: [
        {
          id: 103,
          type: 'JjkText',
          inputs: [
            { name: 'text', type: 'STRING', widget: { name: 'text' }, link: null },
          ],
          outputs: [{ name: 'text', type: 'STRING', links: [9664] }],
          widgets_values: ['old prompt'],
        },
        {
          id: 95,
          type: 'RH_LLMAPI_NODE',
          inputs: [
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: 9664 },
            { name: 'temperature', type: 'FLOAT', widget: { name: 'temperature' } },
          ],
          outputs: [{ name: 'describe', type: 'STRING', links: [3742, 9203] }],
          widgets_values: ['workflow prompt', 0.6],
        },
        {
          id: 102,
          type: 'ProcessString',
          inputs: [
            { name: 'input_string', type: 'STRING', widget: { name: 'input_string' }, link: 3742 },
            { name: 'option', type: 'COMBO', widget: { name: 'option' } },
          ],
          outputs: [{ name: 'STRING', type: 'STRING', links: [3744] }],
          widgets_values: ['', 'remove-new-lines'],
        },
        {
          id: 76,
          type: 'easy promptLine',
          inputs: [
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: 3744 },
            { name: 'start_index', type: 'INT', widget: { name: 'start_index' } },
            { name: 'max_rows', type: 'INT', widget: { name: 'max_rows' } },
          ],
          outputs: [{ name: 'STRING', type: 'STRING', links: [3063, 3064] }],
          widgets_values: ['Next Scene: old', 0, 1000],
        },
        {
          id: 68,
          type: 'TextEncodeQwenImageEditPlus',
          inputs: [
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: 3063 },
          ],
          outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [74] }],
          widgets_values: [''],
        },
        {
          id: 61,
          type: 'TextEncodeQwenImageEditPlus',
          inputs: [
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null },
          ],
          outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [75] }],
          widgets_values: ['old negative prompt'],
        },
        {
          id: 56,
          type: 'KSampler',
          inputs: [
            { name: 'positive', type: 'CONDITIONING', link: 74 },
            { name: 'negative', type: 'CONDITIONING', link: 75 },
          ],
          outputs: [{ name: 'LATENT', type: 'LATENT', links: [1530] }],
          widgets_values: [],
        },
        {
          id: 69,
          type: 'VAEDecode',
          inputs: [
            { name: 'samples', type: 'LATENT', link: 1530 },
          ],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9232] }],
          widgets_values: [],
        },
        {
          id: 105,
          type: 'SaveImage',
          inputs: [
            { name: 'images', type: 'IMAGE', link: 9232 },
            { name: 'filename_prefix', type: 'STRING', widget: { name: 'filename_prefix' } },
          ],
          widgets_values: ['ComfyUI'],
        },
        {
          id: 99,
          type: 'easy showAnything',
          inputs: [
            { name: 'anything', type: '*', link: 3064 },
          ],
          widgets_values: ['old display text'],
        },
        {
          id: 132,
          type: 'ShellAgentPluginOutputText',
          inputs: [
            { name: 'text', type: 'STRING', widget: { name: 'text' }, link: 9203 },
          ],
          widgets_values: ['old output text'],
        },
      ],
      links: [
        [9664, 103, 0, 95, 0, 'STRING'],
        [3742, 95, 0, 102, 0, 'STRING'],
        [3744, 102, 0, 76, 0, 'STRING'],
        [3063, 76, 0, 68, 0, 'STRING'],
        [3064, 76, 0, 99, 0, 'STRING'],
        [74, 68, 0, 56, 0, 'CONDITIONING'],
        [75, 61, 0, 56, 1, 'CONDITIONING'],
        [1530, 56, 0, 69, 0, 'LATENT'],
        [9232, 69, 0, 105, 0, 'IMAGE'],
        [9203, 95, 0, 132, 0, 'STRING'],
      ],
    })

    const graph = resolveComfyUiWorkflow('baseimage/prompt/test-qwen-storyboard-direct-prompt', {
      prompt: 'fresh panel image prompt',
      negativePrompt: 'bad anatomy',
      llmApi: TEST_LLM_API,
    })

    expect(graph['68']?.inputs?.prompt).toBe('fresh panel image prompt')
    expect(graph['61']?.inputs?.prompt).toBe('bad anatomy')
    expect(graph['99']).toBeUndefined()
    expect(graph['132']).toBeUndefined()
    expect(graph['105']?.inputs?.images).toEqual(['69', 0])
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
      llmApi: TEST_LLM_API,
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

  it('bypasses non-media output passthrough nodes in audio workflows so SaveAudio remains the only terminal', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseaudio/prompt/test-audio-output-bypass', {
      nodes: [
        {
          id: 30,
          type: 'FishS2VoiceCloneTTS',
          inputs: [
            { name: 'text', type: 'STRING', widget: { name: 'text' }, link: null },
            { name: 'reference_text', type: 'STRING', link: 60 },
          ],
          outputs: [{ name: 'audio', type: 'AUDIO', links: [61] }],
          widgets_values: ['old line', ''],
        },
        {
          id: 35,
          type: 'SaveAudio',
          inputs: [
            { name: 'audio', type: 'AUDIO', link: 62 },
            { name: 'filename_prefix', type: 'STRING', widget: { name: 'filename_prefix' }, link: null },
          ],
          widgets_values: ['%date:yyyy-MM-dd%/voice_'],
        },
        {
          id: 37,
          type: 'Apply Whisper',
          inputs: [
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null },
          ],
          outputs: [{ name: 'text', type: 'STRING', links: [57] }],
          widgets_values: ['keep reference transcription prompt'],
        },
        {
          id: 38,
          type: 'easy showAnything',
          inputs: [{ name: 'anything', type: '*', link: 58 }],
          outputs: [{ name: 'output', type: '*', links: [60] }],
          widgets_values: ['old reference text'],
        },
        {
          id: 43,
          type: 'LayerUtility: PurgeVRAM V2',
          inputs: [
            { name: 'anything', type: '*', link: 61 },
            { name: 'purge_cache', type: 'BOOLEAN', widget: { name: 'purge_cache' } },
            { name: 'purge_models', type: 'BOOLEAN', widget: { name: 'purge_models' } },
          ],
          outputs: [{ name: 'any', type: '*', links: [62] }],
          widgets_values: [true, true],
        },
        {
          id: 44,
          type: 'LayerUtility: PurgeVRAM V2',
          inputs: [
            { name: 'anything', type: '*', link: 57 },
            { name: 'purge_cache', type: 'BOOLEAN', widget: { name: 'purge_cache' } },
            { name: 'purge_models', type: 'BOOLEAN', widget: { name: 'purge_models' } },
          ],
          outputs: [{ name: 'any', type: '*', links: [58] }],
          widgets_values: [true, true],
        },
      ],
      links: [
        [57, 37, 0, 44, 0, 'STRING'],
        [58, 44, 0, 38, 0, '*'],
        [60, 38, 0, 30, 1, 'STRING'],
        [61, 30, 0, 43, 0, 'AUDIO'],
        [62, 43, 0, 35, 0, 'AUDIO'],
      ],
    })

    const graph = resolveComfyUiWorkflow('baseaudio/prompt/test-audio-output-bypass', {
      prompt: 'fresh voice line',
    })
    const referencedNodeIds = new Set<string>()
    for (const node of Object.values(graph)) {
      for (const value of Object.values(node.inputs)) {
        if (Array.isArray(value) && value.length >= 2) {
          referencedNodeIds.add(String(value[0]))
        }
      }
    }
    const terminalNodes = Object.entries(graph)
      .filter(([nodeId]) => !referencedNodeIds.has(nodeId))
      .map(([nodeId, node]) => ({ nodeId, classType: node.class_type }))

    expect(graph['38']).toBeUndefined()
    expect(graph['43']).toBeUndefined()
    expect(graph['44']).toBeUndefined()
    expect(graph['37']?.inputs?.prompt).toBe('keep reference transcription prompt')
    expect(graph['30']?.inputs?.reference_text).toEqual(['37', 0])
    expect(graph['35']?.inputs?.audio).toEqual(['30', 0])
    expect(terminalNodes).toEqual([{ nodeId: '35', classType: 'SaveAudio' }])
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

  it('injects duration into CONFIG FrameCount primitive nodes', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-config-framecount-injection', {
      nodes: [
        {
          id: 1,
          type: 'PrimitiveInt',
          title: 'CONFIG FrameCount',
          inputs: [
            { name: 'value', type: 'INT', widget: { name: 'value' }, link: null },
          ],
          widgets_values: [7],
        },
        {
          id: 31,
          type: 'PrimitiveInt',
          title: 'CONFIG FrameRate',
          inputs: [
            { name: 'value', type: 'INT', widget: { name: 'value' }, link: null },
          ],
          widgets_values: [24],
        },
        {
          id: 4,
          type: 'MathExpression|pysssss',
          inputs: [
            { name: 'a', type: 'INT', link: 101 },
            { name: 'b', type: 'INT', link: 102 },
            { name: 'expression', type: 'STRING', link: null },
          ],
          widgets_values: ['a*b+1'],
        },
      ],
      links: [
        [101, 1, 0, 4, 0, 'INT'],
        [102, 31, 0, 4, 1, 'INT'],
      ],
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-config-framecount-injection', {
      durationSeconds: 2.2,
      fps: 25,
      targetFrameCount: 55,
    })

    expect(graph['1']?.inputs?.value).toBe(3)
    expect(graph['31']?.inputs?.value).toBe(25)
  })

  it('injects connected image dimensions into constant nodes', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'baseimage/prompt/test-connected-image-dimensions', {
      nodes: [
        {
          id: 24,
          type: 'Int',
          inputs: [
            { name: 'value', type: 'INT', widget: { name: 'value' }, link: null },
          ],
          outputs: [{ name: 'INT', type: 'INT', links: [101, 103] }],
          widgets_values: [768],
        },
        {
          id: 34,
          type: 'Int',
          inputs: [
            { name: 'value', type: 'INT', widget: { name: 'value' }, link: null },
          ],
          outputs: [{ name: 'INT', type: 'INT', links: [102, 104] }],
          widgets_values: [1360],
        },
        {
          id: 52,
          type: 'EmptyFlux2LatentImage',
          inputs: [
            { name: 'width', type: 'INT', link: 101 },
            { name: 'height', type: 'INT', link: 102 },
          ],
          widgets_values: [],
        },
        {
          id: 57,
          type: 'Flux2Scheduler',
          inputs: [
            { name: 'width', type: 'INT', link: 103 },
            { name: 'height', type: 'INT', link: 104 },
          ],
          widgets_values: [],
        },
      ],
      links: [
        [101, 24, 0, 52, 0, 'INT'],
        [102, 34, 0, 52, 1, 'INT'],
        [103, 24, 0, 57, 0, 'INT'],
        [104, 34, 0, 57, 1, 'INT'],
      ],
    })

    const graph = resolveComfyUiWorkflow('baseimage/prompt/test-connected-image-dimensions', {
      width: 1280,
      height: 720,
    })

    expect(graph['24']?.inputs?.value).toBe(1280)
    expect(graph['34']?.inputs?.value).toBe(720)
    expect(graph['52']?.inputs?.width).toEqual(['24', 0])
    expect(graph['52']?.inputs?.height).toEqual(['34', 0])
    expect(graph['57']?.inputs?.width).toEqual(['24', 0])
    expect(graph['57']?.inputs?.height).toEqual(['34', 0])
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

  it('bypasses optional LTX multi-GPU patcher nodes and reconnects downstream model inputs', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-optional-ltx-patcher-bypass', {
      1: {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'ltx-2.3.safetensors',
        },
      },
      28: {
        class_type: 'LTXVConcatAVLatent',
        inputs: {
          model: ['44', 0],
          video_latent: ['43', 0],
          audio_latent: ['26', 0],
        },
      },
      41: {
        class_type: 'SamplerCustomAdvanced',
        inputs: {
          guider: ['17', 0],
          latent_image: ['28', 0],
        },
      },
      44: {
        class_type: 'LTXVSequenceParallelMultiGPUPatcher',
        inputs: {
          torch_compile: true,
          disable_backup: false,
          model: ['1', 0],
        },
      },
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-optional-ltx-patcher-bypass')

    expect(graph['44']).toBeUndefined()
    expect(graph['28']?.inputs?.model).toEqual(['1', 0])
    expect(graph['41']?.inputs?.latent_image).toEqual(['28', 0])
  })

  it('removes editor-only Note nodes from ui workflows before prompt submission', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-remove-note-node', {
      nodes: [
        {
          id: 1,
          type: 'CheckpointLoaderSimple',
          inputs: [
            {
              name: 'ckpt_name',
              type: 'COMBO',
              widget: { name: 'ckpt_name' },
              link: null,
            },
          ],
          widgets_values: ['ltx\\ltx-2.3-22b-dev-fp8.safetensors'],
        },
        {
          id: 259,
          type: 'Note',
          inputs: [],
          widgets_values: ['workflow comment'],
        },
      ],
      links: [],
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-remove-note-node')

    expect(graph['1']?.class_type).toBe('CheckpointLoaderSimple')
    expect(graph['259']).toBeUndefined()
  })

  it('removes editor-only MarkdownNote nodes from ui workflows before prompt submission', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-remove-markdown-note-node', {
      nodes: [
        {
          id: 1,
          type: 'CheckpointLoaderSimple',
          inputs: [
            {
              name: 'ckpt_name',
              type: 'COMBO',
              widget: { name: 'ckpt_name' },
              link: null,
            },
          ],
          widgets_values: ['ltx\\ltx-2.3-22b-dev-fp8.safetensors'],
        },
        {
          id: 226,
          type: 'MarkdownNote',
          inputs: [],
          widgets_values: ['# workflow comment'],
        },
      ],
      links: [],
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-remove-markdown-note-node')

    expect(graph['1']?.class_type).toBe('CheckpointLoaderSimple')
    expect(graph['226']).toBeUndefined()
  })

  it('resolves SetNode and GetNode variables into direct upstream connections', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-resolve-set-get-nodes', {
      nodes: [
        {
          id: 1,
          type: 'FloatConstant',
          inputs: [
            {
              name: 'value',
              type: 'FLOAT',
              widget: { name: 'value' },
              link: null,
            },
          ],
          outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [11] }],
          widgets_values: [25],
        },
        {
          id: 10,
          type: 'SetNode',
          title: 'Set_FLOAT',
          inputs: [
            {
              name: 'FLOAT',
              type: 'FLOAT',
              link: 11,
            },
          ],
          widgets_values: ['fps'],
        },
        {
          id: 20,
          type: 'GetNode',
          title: 'Get_FLOAT',
          inputs: [],
          outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [12] }],
          widgets_values: ['fps'],
        },
        {
          id: 30,
          type: 'VHS_VideoCombine',
          inputs: [
            {
              name: 'frame_rate',
              type: 'FLOAT',
              link: 12,
            },
          ],
          widgets_values: [],
        },
      ],
      links: [
        [11, 1, 0, 10, 0, 'FLOAT'],
        [12, 20, 0, 30, 0, 'FLOAT'],
      ],
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-resolve-set-get-nodes')

    expect(graph['10']).toBeUndefined()
    expect(graph['20']).toBeUndefined()
    expect(graph['30']?.inputs?.frame_rate).toEqual(['1', 0])
  })

  it('moves KJ lanczos resize nodes to cpu when the workflow requests gpu execution', () => {
    workflowRoot = createWorkflowRoot()
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

    writeWorkflow(workflowRoot, 'basevideo/prompt/test-kj-lanczos-gpu-fallback', {
      nodes: [
        {
          id: 91,
          type: 'LoadImage',
          inputs: [
            {
              name: 'image',
              type: 'COMBO',
              widget: { name: 'image' },
              link: null,
            },
            {
              name: 'upload',
              type: 'IMAGEUPLOAD',
              widget: { name: 'upload' },
              link: null,
            },
          ],
          widgets_values: ['demo.png', 'image'],
        },
        {
          id: 93,
          type: 'ImageResizeKJv2',
          inputs: [
            { name: 'image', type: 'IMAGE', link: 108 },
            { name: 'width', type: 'INT', widget: { name: 'width' } },
            { name: 'height', type: 'INT', widget: { name: 'height' } },
            { name: 'upscale_method', type: 'COMBO', widget: { name: 'upscale_method' } },
            { name: 'keep_proportion', type: 'COMBO', widget: { name: 'keep_proportion' } },
            { name: 'pad_color', type: 'STRING', widget: { name: 'pad_color' } },
            { name: 'crop_position', type: 'COMBO', widget: { name: 'crop_position' } },
            { name: 'divisible_by', type: 'INT', widget: { name: 'divisible_by' } },
            { name: 'device', type: 'COMBO', widget: { name: 'device' } },
          ],
          widgets_values: [480, 832, 'lanczos', 'crop', '0, 0, 0', 'center', 16, 'gpu'],
        },
      ],
      links: [
        [108, 91, 0, 93, 0, 'IMAGE'],
      ],
    })

    const graph = resolveComfyUiWorkflow('basevideo/prompt/test-kj-lanczos-gpu-fallback')

    expect(graph['93']?.inputs?.upscale_method).toBe('lanczos')
    expect(graph['93']?.inputs?.device).toBe('cpu')
  })
})
