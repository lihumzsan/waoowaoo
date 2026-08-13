import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import {
  cancelComfyUiH3Video,
  executeComfyUiH3VideoGeneration,
  pollComfyUiH3Video,
} from '@/lib/ai-providers/comfyui/h3'
import { COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import { H3_MODELS, H3_RUNTIME_PROFILES } from '@/lib/ai-providers/comfyui/profiles'
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
  imageUrl: 'https://media.example.com/first-frame.png',
  options: {
    prompt: 'A test video',
    duration: 10,
    resolution: '720p',
    aspectRatio: '16:9',
    generateAudio: true,
  },
}

function objectInfo(className: string): Record<string, unknown> {
  const required: Record<string, unknown> = {}
  if (className === 'UNETLoader') required.unet_name = [[H3_MODELS.diffusion]]
  if (className === 'CLIPLoader') required.clip_name = [[H3_MODELS.textEncoder]]
  if (className === 'LoraLoaderBypassModelOnly') required.lora_name = [[H3_MODELS.turboLora]]
  if (className === 'VAELoader') required.vae_name = [[H3_MODELS.videoVae, H3_MODELS.audioVae]]
  return { [className]: { input: { required } } }
}

function defineValidPreflight(server: Awaited<ReturnType<typeof startScenarioServer>>) {
  for (const className of H3_RUNTIME_PROFILES['h3-fast-first-frame'].requiredNodeClasses) {
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
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)

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
    vi.stubEnv('COMFYUI_BASE_URL', '')

    await expect(executeComfyUiH3VideoGeneration(videoInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      disposition: 'pre_accept_rejected',
      externalId: null,
    })
  })

  it('types a proven prompt 4xx as a rejected submission with its diagnostic', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
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
    expect(server!.getRequests('GET', `/history/${PROMPT_ID}`)).toHaveLength(0)
  })

  it('keeps a prompt 5xx as an unknown acceptance outcome after probing the same prompt id', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST',
      path: '/prompt',
      mode: 'fatal_error',
      submitResponse: { status: 503, body: { error: 'temporarily unavailable' } },
    })
    server!.defineScenario({
      method: 'GET',
      path: `/history/${PROMPT_ID}`,
      mode: 'success',
      submitResponse: { status: 200, body: {} },
    })
    server!.defineScenario({
      method: 'GET',
      path: '/queue',
      mode: 'success',
      submitResponse: { status: 200, body: { queue_running: [], queue_pending: [] } },
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
    expect(server!.getRequests('GET', `/history/${PROMPT_ID}`)).toHaveLength(1)
  })

  it('keeps a prompt 408 uncertain and probes the same prompt id', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'fatal_error',
      submitResponse: { status: 408, body: { error: 'request timeout' } },
    })
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: {} },
    })
    server!.defineScenario({
      method: 'GET', path: '/queue', mode: 'success',
      submitResponse: { status: 200, body: { queue_running: [], queue_pending: [] } },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput))
      .rejects.toThrow('COMFYUI_SUBMIT_OUTCOME_UNKNOWN')
    expect(server!.getRequests('GET', `/history/${PROMPT_ID}`)).toHaveLength(1)
  })

  it('does not accept an unknown same-id probe status', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    defineValidPreflight(server!)
    server!.defineScenario({
      method: 'POST', path: '/prompt', mode: 'fatal_error',
      submitResponse: { status: 503, body: { error: 'temporarily unavailable' } },
    })
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: {} },
    })
    server!.defineScenario({
      method: 'GET', path: '/queue', mode: 'success',
      submitResponse: { status: 200, body: { queue_running: [], queue_pending: [] } },
    })

    await expect(executeComfyUiH3VideoGeneration(videoInput))
      .rejects.toThrow('COMFYUI_SUBMIT_OUTCOME_UNKNOWN')
  })

  it('reads a running prompt from the standard ComfyUI history and queue endpoints', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: {} },
    })
    server!.defineScenario({
      method: 'GET', path: '/queue', mode: 'success',
      submitResponse: { status: 200, body: { queue_running: [[3, PROMPT_ID]], queue_pending: [] } },
    })

    await expect(pollComfyUiH3Video(PROMPT_ID)).resolves.toEqual({
      status: 'pending',
      pendingPhase: 'running',
    })
  })

  it('does not claim to cancel a running prompt through the queue deletion endpoint', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: {} },
    })
    server!.defineScenario({
      method: 'GET', path: '/queue', mode: 'success',
      submitResponse: { status: 200, body: { queue_running: [[3, PROMPT_ID]], queue_pending: [] } },
    })

    await expect(cancelComfyUiH3Video(PROMPT_ID)).resolves.toBeUndefined()
    expect(server!.getRequests('POST', '/queue')).toHaveLength(0)
  })

  it('removes a queue-pending prompt through ComfyUI queue deletion', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: {} },
    })
    server!.defineScenario({
      method: 'GET', path: '/queue', mode: 'success',
      submitResponse: { status: 200, body: { queue_running: [], queue_pending: [[4, PROMPT_ID]] } },
    })
    server!.defineScenario({
      method: 'POST', path: '/queue', mode: 'success',
      submitResponse: { status: 200, body: {} },
    })

    await expect(cancelComfyUiH3Video(PROMPT_ID)).resolves.toBeUndefined()
    expect(server!.getRequests('POST', '/queue')).toHaveLength(1)
  })

  it('rejects a completed video declared above the 100 MiB provider limit', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { [PROMPT_ID]: { status: { status_str: 'success' }, outputs: { '15': { gifs: [{ filename: 'large.mp4', subfolder: '', type: 'output' }] } } } } },
    })
    server!.defineScenario({
      method: 'GET', path: '/view', mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(100 * 1024 * 1024 + 1) } },
    })

    await expect(pollComfyUiH3Video(PROMPT_ID))
      .rejects.toThrow('exceeds the 104857600 byte limit')
  })

  it('rejects a completed output that is not a video', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { [PROMPT_ID]: { status: { status_str: 'success' }, outputs: { '15': { gifs: [{ filename: 'wrong.txt', subfolder: '', type: 'output' }] } } } } },
    })
    server!.defineScenario({
      method: 'GET', path: '/view', mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'not a video' },
    })

    await expect(pollComfyUiH3Video(PROMPT_ID))
      .rejects.toThrow('COMFYUI_OUTPUT_CONTENT_TYPE_INVALID')
  })

  it('rejects a non-MP4 video container before MP4 persistence', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET', path: `/history/${PROMPT_ID}`, mode: 'success',
      submitResponse: { status: 200, body: { [PROMPT_ID]: { status: { status_str: 'success' }, outputs: { '15': { gifs: [{ filename: 'wrong.webm', subfolder: '', type: 'output' }] } } } } },
    })
    server!.defineScenario({
      method: 'GET', path: '/view', mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'video/webm' }, body: 'webm bytes' },
    })

    await expect(pollComfyUiH3Video(PROMPT_ID))
      .rejects.toThrow('COMFYUI_OUTPUT_CONTENT_TYPE_INVALID')
  })
})
