import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { cancelComfyUiH3Video, executeComfyUiH3VideoGeneration, pollComfyUiH3Video } from '@/lib/ai-providers/comfyui/h3'
import { COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import {
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE,
  H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE,
} from '@/lib/ai-providers/comfyui/profiles'
import type { AiProviderVideoExecutionContext } from '@/lib/ai-providers/runtime-types'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

vi.mock('@/lib/media/outbound-owned-media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/media/outbound-owned-media')>()
  return {
    ...actual,
    readOwnedMediaBytesForGeneration: async (
      input: string,
      userId: string,
      options: Parameters<typeof actual.readOwnedMediaBytesForGeneration>[2],
    ) => {
      if (input === 'https://media.example.com/unowned-reference.mp3') {
        throw new Error('OWNED_MEDIA_NOT_FOUND')
      }
      if (input === 'https://media.example.com/reference.mp3') {
        return {
          bytes: Buffer.from([0x49, 0x44, 0x33, 0x04]),
          storageKey: 'tests/h3/reference.mp3',
          contentType: 'audio/mpeg',
          sizeBytes: 4,
          durationMs: 2_000,
        }
      }
      if (input.startsWith('https://media.example.com/reference-') && input.endsWith('.png')) {
        return {
          bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          storageKey: `tests/h3/${input.split('/').at(-1) ?? 'reference.png'}`,
          contentType: 'image/png',
          sizeBytes: 8,
          durationMs: null,
        }
      }
      return await actual.readOwnedMediaBytesForGeneration(input, userId, options)
    },
  }
})

const PROMPT_ID = '00000000-0000-4000-8000-000000000001'

const videoInput: AiProviderVideoExecutionContext = {
  userId: 'user-h3-contract',
  selection: {
    provider: 'comfyui',
    modelId: COMFYUI_H3_MODEL_ID,
    modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`,
    variantSubKind: 'official',
  },
  imageUrl: '',
  options: {
    prompt: 'subject_definitions:\nSubject 1 is in Picture 1.\n\nsummary:\nA test video.\n\nretention_analysis:\nPreserve identity.\n\ndetailed_description:\n[Shot 1] The subject moves and settles.\n\noverall_soundscape:\nRoom tone and movement.\n\nnon_diegetic_music:\nN/A',
    duration: 10,
    aspectRatio: '16:9',
    generateAudio: true,
    referenceImages: ['https://media.example.com/reference-1.png'],
  },
}

const referenceAudioInput: AiProviderVideoExecutionContext = {
  ...videoInput,
  options: {
    ...videoInput.options,
    prompt: `subject_definitions:
<Subject 1> (S1) is the person shown in <Picture 1>.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
<Subject 1> speaks one new line.

retention_analysis:
<Picture 1>: reference - preserve <Subject 1>.
<Audio 1>: reference - <Subject 1> (S1) follows its vocal timbre and measured delivery without copying the original signal.

detailed_description:
[Shot 1] <Subject 1> (S1) faces camera and says <d>[Chinese]这是新台词。</d>

overall_soundscape:
Clean speech with quiet room tone.

non_diegetic_music:
N/A`,
    referenceImages: ['https://media.example.com/reference-1.png'],
    referenceAudios: ['https://media.example.com/reference.mp3'],
  },
}

const firstFrameInput: AiProviderVideoExecutionContext = {
  ...videoInput,
  imageUrl: 'https://media.example.com/first.png',
  options: {
    ...videoInput.options,
    prompt: videoInput.options!.prompt!.replace(
      '[Shot 1] The subject moves and settles.',
      '[Shot 1] <Picture 1> aligns with 0.00 seconds and shows the subject moving and settling.',
    ),
    referenceImages: undefined,
  },
}

const firstLastFrameInput: AiProviderVideoExecutionContext = {
  ...firstFrameInput,
  options: {
    ...firstFrameInput.options,
    prompt: firstFrameInput.options!.prompt!.replace(
      'shows the subject moving and settling.',
      'shows the subject moving and settling exactly into <Picture 2> at 10.125 seconds.',
    ),
    lastFrameImageUrl: 'https://media.example.com/last.png',
  },
}

const continuationInput: AiProviderVideoExecutionContext = {
  ...videoInput,
  options: {
    ...videoInput.options,
    prompt: videoInput.options!.prompt!.replace(
      'Preserve identity.',
      'Continue the inherited identity, pose, camera motion, and action direction.',
    ),
    referenceImages: undefined,
    continuationVideoUrl: 'https://media.example.com/previous.mp4',
  },
}

function objectInfo(className: string): Record<string, unknown> {
  const required: Record<string, unknown> = {}
  const optional: Record<string, unknown> = {}
  if (className === 'UNETLoader') required.unet_name = [[
    'h3\\minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors',
    'h3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    'h3\\minimax_h3_fl2va_int8_convrot.safetensors',
    'h3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  ]]
  if (className === 'CLIPLoader') required.clip_name = [[
    'h3\\qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'h3\\qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  ]]
  if (className === 'LoraLoaderModelOnly') required.lora_name = [[
    'h3\\minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    'h3\\minimax_h3_turbo_4step_10ErosMax_test4_pruned_curveproj1025_exp_v001-T8.safetensors',
    'h3\\Motion_Repair.safetensors',
    'h3\\Minimax H3真实电影质感.safetensors',
    'h3\\H3_Combat_V2.safetensors',
  ]]
  if (className === 'LoraLoaderBypassModelOnly') required.lora_name = [[
    'h3\\minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors',
    'h3\\minimax_h3_turbo_v4_step600_ema_DasiwaREF2VAHybridV1_0_curveproj1025_compat_v001.safetensors',
  ]]
  if (className === 'VAELoader') required.vae_name = [[
    'h3\\minimax_h3_video_vae_fp16.safetensors',
    'h3\\minimax_h3_video_vae_int8_convrot.safetensors',
    'h3\\minimax_h3_audio_vae_fp32.safetensors',
  ]]
  if (className === 'MiniMaxH3LearnedLatentUpscaleT8Advanced') {
    required.model_name = [['minimax_h3_latent_upscaler_3d_fp16.safetensors']]
    required.av_latent = ['LATENT']
    required.size_mode = [['target_megapixels', 'scale_by', 'target_dimensions']]
    required.scale_by = ['FLOAT']
    required.target_megapixels = ['FLOAT']
    required.target_width = ['INT']
    required.target_height = ['INT']
    required.aspect_policy = [['preserve_source', 'stretch']]
    required.max_anisotropy = ['FLOAT']
    required.precision = [['fp16', 'bf16']]
    required.release_policy = [['offload_after', 'keep_loaded']]
  }
  if (className === 'MiniMaxH3AVDecodeT8') {
    required.av_latent = ['LATENT']
    required.video_vae = ['VAE']
    required.audio_vae = ['VAE']
  }
  if (className === 'ImageResizeKJv2') {
    required.upscale_method = [['nvidia_rtx_vsr', 'lanczos']]
    required.width = ['INT']
    required.height = ['INT']
  }
  if (className === 'ModelAttentionBackend') required.attention = [['comfy kitchen attention', 'pytorch attention']]
  if (className === 'LoadImage') required.image = [['example.png']]
  if (className === 'LoadAudio') required.audio = [['example.mp3']]
  if (className === 'ImageBatch') {
    required.image1 = ['IMAGE']
    required.image2 = ['IMAGE']
  }
  if (className === 'MiniMaxH3AddGuide') {
    required.positive = ['CONDITIONING']
    required.latent = ['LATENT']
    required.frame_idx = ['INT']
    optional.vae = ['VAE']
    optional.image = ['IMAGE']
  }
  if (className === 'MiniMaxH3AudioConditioningT8') {
    required.clip = ['CLIP']
    required.video_vae = ['VAE']
    required.audio_vae = ['VAE']
    required.prompt = ['STRING']
    required.width = ['INT']
    required.height = ['INT']
    required.length = ['INT']
    optional.ref_images = [
      'COMFY_AUTOGROW_V3',
      {
        template: {
          input: {
            required: {
              ref_image: ['IMAGE', {}],
            },
          },
          prefix: 'ref_image_',
          min: 1,
          max: 8,
        },
      },
    ]
    optional.ref_audios = [
      'COMFY_AUTOGROW_V3',
      {
        template: {
          input: {
            required: {
              ref_audio: ['AUDIO', {}],
            },
          },
          prefix: 'ref_audio_',
          min: 0,
          max: 3,
        },
      },
    ]
  }
  return { [className]: { input: { required, optional } } }
}

function defineValidPreflight(server: Awaited<ReturnType<typeof startScenarioServer>>) {
  const classes = new Set([
    ...Object.values(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow).map((node) => node.class_type),
    ...Object.values(H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE.workflow).map((node) => node.class_type),
    ...Object.values(H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE.workflow).map((node) => node.class_type),
  ])
  for (const className of classes) {
    server.defineScenario({
      method: 'GET',
      path: `/object_info/${encodeURIComponent(className)}`,
      mode: 'success',
      submitResponse: { status: 200, body: objectInfo(className) },
    })
  }
  server.defineScenario({
    method: 'POST',
    path: '/upload/image',
    mode: 'success',
    pollSequence: Array.from({ length: 20 }, () => ({
      status: 200,
      body: {
        name: 'reference-image-00.png',
        subfolder: `waoowaoo/${PROMPT_ID}`,
        type: 'input',
      },
    })),
  })
}

describe('provider contract - ComfyUI H3 submission disposition', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(PROMPT_ID)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await server?.close()
    server = null
  })

  it('types deterministic local graph validation as a pre-accept rejection', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)

    await expect(executeComfyUiH3VideoGeneration({
      ...videoInput,
      options: { ...videoInput.options, generateAudio: false },
    })).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'PROVIDER_SUBMISSION_REJECTED',
      disposition: 'pre_accept_rejected',
      externalId: null,
      failure: { frames: [{ system: 'provider', provider: 'comfyui', phase: 'submit' }] },
    })
    expect(server!.getRequests('GET', '/object_info/UNETLoader')).toHaveLength(0)
  })

  it('types a missing ComfyUI base URL as a pre-accept rejection', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', '')

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
    })
  })

  it('types a proven prompt 4xx as a rejected submission with its diagnostic', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST',
      path: '/prompt',
      mode: 'fatal_error',
      submitResponse: { status: 400, body: { error: 'invalid H3 prompt' } },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'PROVIDER_SUBMISSION_REJECTED',
      disposition: 'rejected',
      externalId: null,
      failure: {
        interpretation: { details: { httpStatus: 400, payload: { error: 'invalid H3 prompt' } } },
        frames: [{ system: 'provider', provider: 'comfyui', phase: 'submit' }],
      },
    })
    expect(server!.getRequests('GET', `/api/jobs/${PROMPT_ID}`)).toHaveLength(0)
  })

  it('keeps a prompt 5xx as an unknown acceptance outcome after probing the same prompt id', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST',
      path: '/prompt',
      mode: 'fatal_error',
      submitResponse: { status: 503, body: { error: 'temporarily unavailable' } },
    })
    server!.defineScenario({
      method: 'GET',
      path: `/api/jobs/${PROMPT_ID}`,
      mode: 'fatal_error',
      submitResponse: { status: 404, body: { error: 'not found' } },
    })

    let captured: unknown = null
    try {
      await executeComfyUiH3VideoGeneration(videoInput)
    } catch (error) {
      captured = error
    }

    expect(captured).toBeInstanceOf(Error)
    expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
    expect(captured).toMatchObject({ message: expect.stringContaining('COMFYUI_SUBMIT_OUTCOME_UNKNOWN') })
    expect(server!.getRequests('GET', `/api/jobs/${PROMPT_ID}`)).toHaveLength(1)
  })

  it('keeps a prompt 408 uncertain and probes the same prompt id', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'fatal_error',
      submitResponse: { status: 408, body: { error: 'request timeout' } },
    })
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'fatal_error',
      submitResponse: { status: 404, body: { error: 'not found' } },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput))
      .rejects.toThrow('COMFYUI_SUBMIT_OUTCOME_UNKNOWN')
    expect(server!.getRequests('GET', `/api/jobs/${PROMPT_ID}`)).toHaveLength(1)
  })

  it('caches a successful target-local preflight for the short submission burst', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    await executeComfyUiH3VideoGeneration(videoInput)
    await executeComfyUiH3VideoGeneration(videoInput)

    expect(server!.getRequests('GET', '/object_info/UNETLoader')).toHaveLength(1)
    expect(server!.getRequests('GET', '/object_info/CLIPLoader')).toHaveLength(1)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(2)
  })

  it('uploads ordered reference images and submits the 15-second T8 MP plan once', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST',
      path: '/upload/image',
      mode: 'success',
      pollSequence: [0, 1].map((index) => ({
        status: 200,
        body: {
          name: `reference-image-${String(index).padStart(2, '0')}.png`,
          subfolder: `waoowaoo/${PROMPT_ID}`,
          type: 'input',
        },
      })),
    })
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    await executeComfyUiH3VideoGeneration({
      ...videoInput,
      options: {
        ...videoInput.options,
        duration: 15,
        aspectRatio: '9:21',
        referenceImages: [
          'https://media.example.com/reference-1.png',
          'https://media.example.com/reference-2.png',
        ],
      },
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(2)
    const request = server!.getRequests('POST', '/prompt')[0]
    const body = JSON.parse(request!.bodyText) as { prompt: Record<string, { inputs?: Record<string, unknown> }> }
    expect(body.prompt['6']?.inputs?.image).toBe(`waoowaoo/${PROMPT_ID}/reference-image-00.png`)
    expect(body.prompt['60']?.inputs?.image).toBe(`waoowaoo/${PROMPT_ID}/reference-image-01.png`)
    for (const conditioningId of ['7', '14']) {
      expect(body.prompt[conditioningId]?.inputs?.['ref_images.ref_image_0']).toEqual(['6', 0])
      expect(body.prompt[conditioningId]?.inputs?.['ref_images.ref_image_1']).toEqual(['60', 0])
      expect(body.prompt[conditioningId]?.inputs?.length).toBe(362)
    }
    expect(body.prompt['7']?.inputs).toMatchObject({ width: 448, height: 1088 })
    expect(body.prompt['13']?.inputs).toMatchObject({ target_megapixels: 0.67 })
    expect(body.prompt['55']?.inputs).toMatchObject({ width: 960, height: 2208 })
    expect(body.prompt['168']?.inputs).toMatchObject({
      format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 10, frame_rate: 24,
    })
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(1)
  })

  it('uploads one owned reference audio and submits one graph with the matching H3 audio slot', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST',
      path: '/upload/image',
      mode: 'success',
      pollSequence: [
        {
          status: 200,
          body: {
            name: 'reference-image-00.png',
            subfolder: `waoowaoo/${PROMPT_ID}`,
            type: 'input',
          },
        },
        {
          status: 200,
          body: {
            name: 'reference-audio-00.mp3',
            subfolder: `waoowaoo/${PROMPT_ID}`,
            type: 'input',
          },
        },
      ],
    })
    server!.defineScenario({
      method: 'POST',
      path: '/prompt',
      mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    const result = await executeComfyUiH3VideoGeneration(referenceAudioInput)

    expect(result.externalId).toBe(`COMFYUI:h3-dual-stage-2mp:VIDEO:${PROMPT_ID}`)
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(2)
    const promptRequests = server!.getRequests('POST', '/prompt')
    expect(promptRequests).toHaveLength(1)
    const body = JSON.parse(promptRequests[0]!.bodyText) as {
      prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>
    }
    expect(body.prompt['18']).toEqual({
      class_type: 'LoadAudio',
      inputs: { audio: `waoowaoo/${PROMPT_ID}/reference-audio-00.mp3` },
    })
    expect(body.prompt['7']?.inputs['ref_audios.ref_audio_0']).toEqual(['18', 0])
    expect(body.prompt['14']?.inputs['ref_audios.ref_audio_0']).toEqual(['18', 0])
  })

  it('reads every owned reference before starting any ComfyUI upload', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)

    await expect(executeComfyUiH3VideoGeneration({
      ...referenceAudioInput,
      options: {
        ...referenceAudioInput.options,
        referenceAudios: ['https://media.example.com/unowned-reference.mp3'],
      },
    })).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining('OWNED_MEDIA_NOT_FOUND'),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('submits an image-only reference graph when optional reference-audio nodes are unavailable', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const withoutReferenceAudio = objectInfo('MiniMaxH3AudioConditioningT8')
    const optional = (
      withoutReferenceAudio.MiniMaxH3AudioConditioningT8 as { input: { optional: Record<string, unknown> } }
    ).input.optional
    delete optional.ref_audios
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AudioConditioningT8',
      mode: 'success',
      submitResponse: { status: 200, body: withoutReferenceAudio },
    })
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/LoadAudio',
      mode: 'success',
      submitResponse: { status: 200, body: {} },
    })
    server!.defineScenario({
      method: 'POST',
      path: '/prompt',
      mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    const result = await executeComfyUiH3VideoGeneration(videoInput)

    expect(result.externalId).toBe(`COMFYUI:h3-dual-stage-2mp:VIDEO:${PROMPT_ID}`)
    const body = JSON.parse(server!.getRequests('POST', '/prompt')[0]!.bodyText) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>
    }
    expect(body.prompt['7']?.inputs['ref_audios.ref_audio_0']).toBeUndefined()
    expect(body.prompt['14']?.inputs['ref_audios.ref_audio_0']).toBeUndefined()
  })

  it('rejects an incompatible H3 reference-audio port before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('MiniMaxH3AudioConditioningT8')
    const optional = (
      incompatible.MiniMaxH3AudioConditioningT8 as { input: { optional: Record<string, unknown> } }
    ).input.optional
    const refAudios = optional.ref_audios as [string, {
      template: { input: { required: Record<string, unknown> } }
    }]
    refAudios[1].template.input.required.ref_audio = ['MASK', {}]
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AudioConditioningT8',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(referenceAudioInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining(
        'COMFYUI_NODE_INPUT_INCOMPATIBLE:MiniMaxH3AudioConditioningT8:ref_audios:AUDIO',
      ),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects a missing T8 conditioning node before uploading reference images', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AudioConditioningT8',
      mode: 'success',
      submitResponse: { status: 200, body: {} },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining('COMFYUI_NODE_MISSING:MiniMaxH3AudioConditioningT8'),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects an image autogrow capacity below eight before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('MiniMaxH3AudioConditioningT8')
    const optional = (
      incompatible.MiniMaxH3AudioConditioningT8 as { input: { optional: Record<string, unknown> } }
    ).input.optional
    const refImages = optional.ref_images as [string, { template: { max: number } }]
    refImages[1].template.max = 7
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AudioConditioningT8',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining(
        'COMFYUI_NODE_INPUT_INCOMPATIBLE:MiniMaxH3AudioConditioningT8:ref_images:IMAGE',
      ),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects an audio autogrow capacity below three before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('MiniMaxH3AudioConditioningT8')
    const optional = (
      incompatible.MiniMaxH3AudioConditioningT8 as { input: { optional: Record<string, unknown> } }
    ).input.optional
    const refAudios = optional.ref_audios as [string, { template: { max: number } }]
    refAudios[1].template.max = 2
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AudioConditioningT8',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(referenceAudioInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining(
        'COMFYUI_NODE_INPUT_INCOMPATIBLE:MiniMaxH3AudioConditioningT8:ref_audios:AUDIO',
      ),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects a missing bypass LoRA before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('LoraLoaderBypassModelOnly')
    const required = (
      incompatible.LoraLoaderBypassModelOnly as { input: { required: Record<string, unknown> } }
    ).input.required
    required.lora_name = [['another-lora.safetensors']]
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/LoraLoaderBypassModelOnly',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining('COMFYUI_MODEL_MISSING:h3\\'),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects a missing learned latent upscaler model before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('MiniMaxH3LearnedLatentUpscaleT8Advanced')
    const required = (
      incompatible.MiniMaxH3LearnedLatentUpscaleT8Advanced as {
        input: { required: Record<string, unknown> }
      }
    ).input.required
    required.model_name = [['another-upscaler.safetensors']]
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3LearnedLatentUpscaleT8Advanced',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining(
        'COMFYUI_MODEL_MISSING:minimax_h3_latent_upscaler_3d_fp16.safetensors',
      ),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects an incompatible learned-upscaler dimension port before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('MiniMaxH3LearnedLatentUpscaleT8Advanced')
    const required = (
      incompatible.MiniMaxH3LearnedLatentUpscaleT8Advanced as {
        input: { required: Record<string, unknown> }
      }
    ).input.required
    required.target_width = ['STRING']
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3LearnedLatentUpscaleT8Advanced',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining(
        'COMFYUI_NODE_INPUT_INCOMPATIBLE:MiniMaxH3LearnedLatentUpscaleT8Advanced:target_width:INT',
      ),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects a missing learned-upscaler mode before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('MiniMaxH3LearnedLatentUpscaleT8Advanced')
    const required = (
      incompatible.MiniMaxH3LearnedLatentUpscaleT8Advanced as {
        input: { required: Record<string, unknown> }
      }
    ).input.required
    required.size_mode = [['scale_by', 'target_dimensions']]
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3LearnedLatentUpscaleT8Advanced',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining(
        'COMFYUI_OPTION_MISSING:MiniMaxH3LearnedLatentUpscaleT8Advanced:size_mode:target_megapixels',
      ),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects an incompatible final VSR dimension port before uploading bytes', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('ImageResizeKJv2')
    const required = (
      incompatible.ImageResizeKJv2 as { input: { required: Record<string, unknown> } }
    ).input.required
    required.width = ['STRING']
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/ImageResizeKJv2',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining('COMFYUI_NODE_INPUT_INCOMPATIBLE:ImageResizeKJv2:width:INT'),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects a reference graph whose final mux bypasses the canonical audio decoder', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    const outputNode = H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[
      H3_DUAL_STAGE_RUNTIME_PROFILE.outputNodeId
    ]!
    const originalAudio = outputNode.inputs.audio
    outputNode.inputs.audio = ['120', 0]
    try {
      await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
        name: 'ProviderSubmissionError',
        disposition: 'pre_accept_rejected',
        externalId: null,
        message: expect.stringContaining(
          'COMFYUI_H3_REFERENCE_T8_GRAPH_INCOMPATIBLE:output',
        ),
      })
    } finally {
      outputNode.inputs.audio = originalAudio
    }
    expect(server!.getRequests('GET', '/object_info/UNETLoader')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('routes first-frame and first-last-frame transport through the same frame profile', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    const referenceResult = await executeComfyUiH3VideoGeneration(videoInput)
    const firstResult = await executeComfyUiH3VideoGeneration(firstFrameInput)
    const firstLastResult = await executeComfyUiH3VideoGeneration(firstLastFrameInput)
    expect(referenceResult.endpoint).toBe('h3-dual-stage-2mp')
    expect(firstResult.endpoint).toBe('h3-dual-stage-2mp')
    expect(firstLastResult.endpoint).toBe('h3-dual-stage-2mp')

    const requests = server!.getRequests('POST', '/prompt')
    const referenceGraph = JSON.parse(requests[0]!.bodyText).prompt as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    const firstGraph = JSON.parse(requests[1]!.bodyText).prompt as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    const firstLastGraph = JSON.parse(requests[2]!.bodyText).prompt as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(referenceGraph['7']?.class_type).toBe('MiniMaxH3AudioConditioningT8')
    expect(referenceGraph['14']?.class_type).toBe('MiniMaxH3AudioConditioningT8')
    expect(firstGraph['309']?.class_type).toBe('MiniMaxH3ImageToVideo')
    expect(firstGraph['137']?.inputs.url).toBe('https://media.example.com/first.png')
    expect(firstGraph['309']?.inputs.first_frame).toEqual(['198', 0])
    expect(firstGraph['309']?.inputs.last_frame).toBeUndefined()
    expect(firstGraph['326']).toBeUndefined()
    expect(firstGraph['327']).toBeUndefined()
    expect(firstLastGraph['309']?.class_type).toBe('MiniMaxH3ImageToVideo')
    expect(firstLastGraph['326']?.inputs.url).toBe('https://media.example.com/last.png')
    expect(firstLastGraph['309']?.inputs.last_frame).toEqual(['327', 0])
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(1)
  })

  it('keys the preflight cache by the selected frozen profile fingerprint', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    await executeComfyUiH3VideoGeneration(videoInput)
    await executeComfyUiH3VideoGeneration(firstFrameInput)

    expect(server!.getRequests('GET', '/object_info/UNETLoader')).toHaveLength(2)
    expect(server!.getRequests('GET', '/object_info/MiniMaxH3AudioConditioningT8')).toHaveLength(1)
    expect(server!.getRequests('GET', '/object_info/MiniMaxH3ImageToVideo')).toHaveLength(1)
  })

  it('fails continuation before upload when the selected AddGuide node is missing', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AddGuide',
      mode: 'success',
      submitResponse: { status: 200, body: {} },
    })

    await expect(executeComfyUiH3VideoGeneration(continuationInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining('COMFYUI_NODE_MISSING:MiniMaxH3AddGuide'),
    })
    expect(server!.getRequests('GET', '/object_info/MiniMaxH3AddGuide')).toHaveLength(1)
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('fails locally when the selected continuation graph omits the required image guide', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    const guide = H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE.workflow[
      H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE.continuationGuideNodeId
    ]!
    const originalImage = guide.inputs.image
    delete guide.inputs.image

    try {
      await expect(executeComfyUiH3VideoGeneration(continuationInput)).rejects.toMatchObject({
        name: 'ProviderSubmissionError',
        disposition: 'pre_accept_rejected',
        externalId: null,
        message: expect.stringContaining('COMFYUI_H3_CONTINUATION_GRAPH_INCOMPATIBLE:image'),
      })
      expect(server!.getRequests('GET', '/object_info/MiniMaxH3AddGuide')).toHaveLength(0)
      expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
      expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
    } finally {
      guide.inputs.image = originalImage
    }
  })

  it('fails locally when the selected continuation graph references a non-VAE guide source', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    const guide = H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE.workflow[
      H3_CONTINUATION_DUAL_STAGE_RUNTIME_PROFILE.continuationGuideNodeId
    ]!
    const originalVae = guide.inputs.vae
    guide.inputs.vae = ['999', 0]

    try {
      await expect(executeComfyUiH3VideoGeneration(continuationInput)).rejects.toMatchObject({
        name: 'ProviderSubmissionError',
        disposition: 'pre_accept_rejected',
        externalId: null,
        message: expect.stringContaining('COMFYUI_H3_CONTINUATION_GRAPH_INCOMPATIBLE:vae'),
      })
      expect(server!.getRequests('GET', '/object_info/MiniMaxH3AddGuide')).toHaveLength(0)
      expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
      expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
    } finally {
      guide.inputs.vae = originalVae
    }
  })

  it('fails continuation before upload when an AddGuide input port is incompatible', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const incompatible = objectInfo('MiniMaxH3AddGuide')
    const optional = (
      incompatible.MiniMaxH3AddGuide as { input: { optional: Record<string, unknown> } }
    ).input.optional
    optional.image = ['MASK']
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AddGuide',
      mode: 'success',
      submitResponse: { status: 200, body: incompatible },
    })

    await expect(executeComfyUiH3VideoGeneration(continuationInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining('COMFYUI_NODE_INPUT_INCOMPATIBLE:MiniMaxH3AddGuide:image:IMAGE'),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('requires AddGuide image inputs in the official optional schema section', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    const wrongSection = objectInfo('MiniMaxH3AddGuide')
    const input = (
      wrongSection.MiniMaxH3AddGuide as {
        input: {
          required: Record<string, unknown>
          optional: Record<string, unknown>
        }
      }
    ).input
    input.required.image = input.optional.image
    delete input.optional.image
    server!.defineScenario({
      method: 'GET',
      path: '/object_info/MiniMaxH3AddGuide',
      mode: 'success',
      submitResponse: { status: 200, body: wrongSection },
    })

    await expect(executeComfyUiH3VideoGeneration(continuationInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
      message: expect.stringContaining('COMFYUI_NODE_INPUT_INCOMPATIBLE:MiniMaxH3AddGuide:image:IMAGE'),
    })
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('accepts the official AddGuide schema before resolving owned continuation media', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)

    let captured: unknown = null
    try {
      await executeComfyUiH3VideoGeneration(continuationInput)
    } catch (error) {
      captured = error
    }
    expect(captured).toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
    })
    expect((captured as Error).message).not.toContain('COMFYUI_NODE_')
    expect(server!.getRequests('GET', '/object_info/MiniMaxH3AddGuide')).toHaveLength(1)
    expect(server!.getRequests('POST', '/upload/image')).toHaveLength(0)
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('rejects invalid mixed, last-only, audio-only, and video references before prompt submission', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    const invalidInputs: AiProviderVideoExecutionContext[] = [
      {
        ...firstFrameInput,
        options: { ...firstFrameInput.options, referenceImages: ['https://media.example.com/reference.png'] },
      },
      {
        ...firstLastFrameInput,
        imageUrl: '',
      },
      {
        ...videoInput,
        options: {
          ...referenceAudioInput.options,
          referenceImages: undefined,
        },
      },
      {
        ...videoInput,
        options: { ...videoInput.options, referenceVideos: ['https://media.example.com/reference.mp4'] },
      },
    ]

    for (const input of invalidInputs) {
      await expect(executeComfyUiH3VideoGeneration(input)).rejects.toMatchObject({
        name: 'ProviderSubmissionError',
        disposition: 'pre_accept_rejected',
        externalId: null,
      })
    }
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(0)
  })

  it('does not accept an unknown same-id probe status', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'fatal_error',
      submitResponse: { status: 503, body: { error: 'temporarily unavailable' } },
    })
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { status: 'not_found' } },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput))
      .rejects.toThrow('COMFYUI_SUBMIT_OUTCOME_UNKNOWN')
  })

  it('rejects a completed video declared above the shared 512 MiB provider limit', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { status: 'completed', outputs: { '168': { gifs: [{ filename: 'large.mp4', subfolder: '', type: 'output' }] } } } },
    })
    server!.defineScenario({
      method: 'GET', path: '/view', mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(512 * 1024 * 1024 + 1) } },
    })

    await expect(pollComfyUiH3Video(PROMPT_ID))
      .rejects.toThrow('exceeds the 536870912 byte limit')
  })

  it('downloads a completed H3 MP4 to a temporary file instead of returning a Base64 data URL', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { status: 'completed', outputs: { '168': { gifs: [{ filename: 'final.mp4', subfolder: '', type: 'output' }] } } } },
    })
    server!.defineScenario({
      method: 'GET', path: '/view', mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'video/mp4' }, body: 'mp4-bytes' },
    })

    const result = await pollComfyUiH3Video(PROMPT_ID)
    expect(result).toMatchObject({ status: 'completed', temporaryMediaFile: { kind: 'temporary_file', contentType: 'video/mp4' } })
    const temporaryMediaFile = (result as { temporaryMediaFile?: { path: string; directory: string } }).temporaryMediaFile
    expect(temporaryMediaFile).toBeTruthy()
    try {
      expect(await readFile(temporaryMediaFile!.path, 'utf8')).toBe('mp4-bytes')
    } finally {
      await rm(temporaryMediaFile!.directory, { recursive: true, force: true })
    }
  })

  it('rejects a provider cancel when the provider confirms the job is still running', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'POST', path: `/api/jobs/${PROMPT_ID}/cancel`, mode: 'fatal_error',
      submitResponse: { status: 400, body: { error: 'cannot cancel' } },
    })
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { status: 'in_progress' } },
    })

    await expect(cancelComfyUiH3Video(PROMPT_ID)).rejects.toThrow('COMFYUI_CANCEL_REJECTED:in_progress')
  })

  it('accepts a cancel 400 only when the provider proves the job is terminal', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'POST', path: `/api/jobs/${PROMPT_ID}/cancel`, mode: 'fatal_error',
      submitResponse: { status: 400, body: { error: 'already done' } },
    })
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { status: 'cancelled' } },
    })

    await expect(cancelComfyUiH3Video(PROMPT_ID)).resolves.toBeUndefined()
  })

  it('rejects a completed output that is not a video', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { status: 'completed', outputs: { '168': { gifs: [{ filename: 'wrong.txt', subfolder: '', type: 'output' }] } } } },
    })
    server!.defineScenario({
      method: 'GET', path: '/view', mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'not a video' },
    })

    await expect(pollComfyUiH3Video(PROMPT_ID))
      .rejects.toThrow('COMFYUI_VIDEO_OUTPUT_MISSING')
  })

  it('rejects a non-MP4 video container before MP4 persistence', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/api/jobs/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { status: 'completed', outputs: { '168': { gifs: [{ filename: 'wrong.webm', subfolder: '', type: 'output' }] } } } },
    })
    server!.defineScenario({
      method: 'GET', path: '/view', mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'video/webm' }, body: 'webm bytes' },
    })

    await expect(pollComfyUiH3Video(PROMPT_ID))
      .rejects.toThrow('COMFYUI_VIDEO_OUTPUT_MISSING')
  })
})
