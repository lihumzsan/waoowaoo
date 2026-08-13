import { describe, expect, it } from 'vitest'
import {
  buildMossTtsPromptGraph,
  MOSS_TTS_LOCAL_PROFILE,
} from '@/lib/ai-providers/comfyui/tts'
import {
  COMFYUI_MOSS_TTS_LOCAL_MODEL_ID,
  COMFYUI_MOSS_TTS_LOCAL_MODEL_KEY,
} from '@/lib/ai-providers/comfyui/models'
import {
  validateMossTtsReferenceAudioMetadata,
} from '@/lib/ai-providers/comfyui/moss-tts-reference-policy'

describe('ComfyUI MOSS TTS Local profile', () => {
  it('builds the API graph from frozen text and reference input', () => {
    const result = buildMossTtsPromptGraph({
      text: '这是正式旁白。',
      language: 'zh',
      referenceAudio: 'voiceover/ref.wav',
      seed: 42,
    })

    expect(MOSS_TTS_LOCAL_PROFILE.modelId).toBe(COMFYUI_MOSS_TTS_LOCAL_MODEL_ID)
    expect(result.graph['6']).toEqual({
      class_type: 'MossTTSModelLoader',
      inputs: {
        model_variant: 'MOSS-TTS (Local 1.7B)',
        local_model_path: 'D:\\workspace\\comfui\\dapao2604\\ComfyUI\\models\\moss-tts\\OpenMOSS-Team--MOSS-TTS-Local-Transformer',
        codec_local_path: 'D:\\workspace\\comfui\\dapao2604\\ComfyUI\\models\\moss-tts\\OpenMOSS-Team--MOSS-Audio-Tokenizer',
      },
    })
    expect(result.graph).toMatchObject({
      '3': { class_type: 'LoadAudio', inputs: { audio: 'voiceover/ref.wav' } },
      '6': { class_type: 'MossTTSModelLoader' },
      '7': {
        class_type: 'MossTTSGenerate',
        inputs: {
          text: '这是正式旁白。',
          language: 'zh',
          reference_audio: ['3', 0],
          seed: 42,
        },
      },
      '5': { class_type: 'SaveAudioMP3', inputs: { audio: ['7', 0] } },
    })
  })

  it('rejects empty text and unsupported language', () => {
    expect(() => buildMossTtsPromptGraph({
      text: '', language: 'zh', referenceAudio: 'ref.wav', seed: 1,
    })).toThrow('COMFYUI_MOSS_TTS_TEXT_REQUIRED')
    expect(() => buildMossTtsPromptGraph({
      text: 'hello', language: 'fr', referenceAudio: 'ref.wav', seed: 1,
    })).toThrow('COMFYUI_MOSS_TTS_LANGUAGE_INVALID')
  })

  it('uses the canonical model key', () => {
    expect(COMFYUI_MOSS_TTS_LOCAL_MODEL_KEY).toBe('comfyui::moss-tts-local-1.7b')
  })

  it.each([
    ['audio/mpeg', 'audio/mpeg'],
    ['audio/mp3', 'audio/mpeg'],
    ['audio/wav', 'audio/wav'],
    ['audio/x-wav', 'audio/wav'],
    ['audio/flac', 'audio/flac'],
    ['audio/x-flac', 'audio/flac'],
  ])('accepts MOSS reference MIME %s as canonical %s', (mimeType, expectedMimeType) => {
    expect(validateMossTtsReferenceAudioMetadata({
      mimeType,
      sizeBytes: BigInt(15 * 1024 * 1024),
    })).toEqual({ mimeType: expectedMimeType, sizeBytes: 15 * 1024 * 1024 })
  })

  it.each([
    [{ mimeType: 'audio/ogg', sizeBytes: BigInt(1024) }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_MIME_TYPE_UNSUPPORTED'],
    [{ mimeType: 'audio/mpeg', sizeBytes: BigInt(15 * 1024 * 1024 + 1) }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_TOO_LARGE'],
    [{ mimeType: null, sizeBytes: BigInt(1024) }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_MIME_TYPE_MISSING'],
    [{ mimeType: 'audio/mpeg', sizeBytes: null }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_SIZE_BYTES_MISSING'],
  ])('rejects invalid frozen MOSS reference metadata %#', (metadata, error) => {
    expect(() => validateMossTtsReferenceAudioMetadata(metadata)).toThrow(error)
  })
})
