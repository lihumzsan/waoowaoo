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
    referenceImages: ['https://media.example.com/reference-1.png', 'https://media.example.com/reference-2.png'],
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
    'h3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    'h3\\minimax_h3_fl2va_int8_convrot.safetensors',
    'h3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  ]]
  if (className === 'CLIPLoader') required.clip_name = [['h3\\qwen3vl_32b_minimax_h3_int8_convrot.safetensors']]
  if (className === 'LoraLoaderModelOnly') required.lora_name = [['h3\\minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']]
  if (className === 'VAELoader') required.vae_name = [['h3\\minimax_h3_video_vae_int8_convrot.safetensors', 'h3\\minimax_h3_audio_vae_fp32.safetensors']]
  if (className === 'ImageResizeKJv2') required.upscale_method = [['nvidia_rtx_vsr', 'lanczos']]
  if (className === 'ModelAttentionBackend') required.attention = [['comfy kitchen attention']]
  if (className === 'LoadImage') required.image = [['example.png']]
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

  it('submits every ordered reference image to the matching H3 slot without changing the frozen reference graph', async () => {
    vi.stubEnv('COMFYUI_H3_DUAL_STAGE_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    await executeComfyUiH3VideoGeneration(videoInput)
    const request = server!.getRequests('POST', '/prompt')[0]
    const body = JSON.parse(request!.bodyText) as { prompt: Record<string, { inputs?: Record<string, unknown> }> }
    expect(body.prompt['137']?.inputs?.url).toBe('https://media.example.com/reference-1.png')
    expect(body.prompt['326']?.inputs?.url).toBe('https://media.example.com/reference-2.png')
    expect(body.prompt['309']?.inputs?.['ref_images.ref_image_0']).toEqual(['198', 0])
    expect(body.prompt['309']?.inputs?.['ref_images.ref_image_1']).toEqual(['333', 0])
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
    expect(referenceGraph['309']?.class_type).toBe('MiniMaxH3ReferenceToVideo')
    expect(firstGraph['309']?.class_type).toBe('MiniMaxH3ImageToVideo')
    expect(firstGraph['137']?.inputs.url).toBe('https://media.example.com/first.png')
    expect(firstGraph['309']?.inputs.first_frame).toEqual(['198', 0])
    expect(firstGraph['309']?.inputs.last_frame).toBeUndefined()
    expect(firstGraph['326']).toBeUndefined()
    expect(firstGraph['327']).toBeUndefined()
    expect(firstLastGraph['309']?.class_type).toBe('MiniMaxH3ImageToVideo')
    expect(firstLastGraph['326']?.inputs.url).toBe('https://media.example.com/last.png')
    expect(firstLastGraph['309']?.inputs.last_frame).toEqual(['327', 0])
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
    expect(server!.getRequests('GET', '/object_info/MiniMaxH3ReferenceToVideo')).toHaveLength(1)
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

  it('rejects invalid mixed, last-only, audio, and video references before prompt submission', async () => {
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
        options: { ...videoInput.options, referenceAudios: ['https://media.example.com/reference.mp3'] },
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
