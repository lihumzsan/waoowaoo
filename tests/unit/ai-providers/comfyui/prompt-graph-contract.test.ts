import { describe, expect, it } from 'vitest'
import { assertComfyUiPromptGraphRuntimeContract } from '@/lib/ai-providers/comfyui/prompt-graph-contract'
import type { ComfyUiPromptGraph } from '@/lib/ai-providers/comfyui/profiles'

// Wire oracle: H3 /object_info/SaveAudioAdvanced, read 2026-09-06.
// Preserve the dynamic selector and dependent input schemas from that response.
const infoByClassName = new Map<string, unknown>([
  ['SaveAudioAdvanced', { SaveAudioAdvanced: {
    input: { required: {
      audio: ['AUDIO', { tooltip: 'The audio to save.' }],
      filename_prefix: ['STRING', { default: 'audio/ComfyUI', multiline: false }],
      format: ['COMFY_DYNAMICCOMBO_V3', { options: [
        { key: 'flac', inputs: { required: {} } },
        { key: 'mp3', inputs: { required: { quality: ['COMBO', { default: 'V0', multiselect: false, options: ['V0', '128k', '320k'] }] } } },
        { key: 'opus', inputs: { required: { quality: ['COMBO', { default: '128k', multiselect: false, options: ['64k', '96k', '128k', '192k', '320k'] }] } } },
      ] }],
    } }, output: ['AUDIO'],
  } }],
  ['VAEDecodeAudio', { VAEDecodeAudio: { input: { required: {} }, output: ['AUDIO'] } }],
])

function assertOutputInputs(inputs: Record<string, unknown>): void {
  const graph: ComfyUiPromptGraph = {
    '48': { class_type: 'VAEDecodeAudio', inputs: {} },
    '107': { class_type: 'SaveAudioAdvanced', inputs: { audio: ['48', 0], filename_prefix: 'test/audio', ...inputs } },
  }
  assertComfyUiPromptGraphRuntimeContract({
    graph, infoByClassName,
    createOptionMismatchError: ({ className, inputName, value }) => new Error(`OPTION_MISMATCH:${className}:${inputName}:${value}`),
  })
}

describe('ComfyUI dynamic combo wire contract', () => {
  it('accepts an advertised format and its qualified required quality input', () => {
    expect(() => assertOutputInputs({ format: 'mp3', 'format.quality': 'V0' })).not.toThrow()
    expect(() => assertOutputInputs({ format: 'flac' })).not.toThrow()
  })

  it('rejects missing dependent inputs and values belonging to another format', () => {
    expect(() => assertOutputInputs({ format: 'mp3' })).toThrow('COMFYUI_GRAPH_REQUIRED_INPUT_MISSING:107:SaveAudioAdvanced:format.quality')
    expect(() => assertOutputInputs({ format: 'opus', 'format.quality': 'V0' })).toThrow('OPTION_MISMATCH:SaveAudioAdvanced:format.quality:V0')
    expect(() => assertOutputInputs({ format: 'flac', 'format.quality': 'V0' })).toThrow('COMFYUI_GRAPH_INPUT_UNDECLARED:107:SaveAudioAdvanced:format.quality')
  })

  it('rejects an unadvertised selector and undeclared dependent inputs', () => {
    expect(() => assertOutputInputs({ format: 'wav' })).toThrow('OPTION_MISMATCH:SaveAudioAdvanced:format:wav')
    expect(() => assertOutputInputs({ format: 'mp3', 'format.quality': 'V0', 'format.bitrate': 128 })).toThrow('COMFYUI_GRAPH_INPUT_UNDECLARED:107:SaveAudioAdvanced:format.bitrate')
  })
})
