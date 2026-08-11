import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMossSoundEffectPromptGraph,
  executeComfyUiMossSoundGeneration,
  MOSS_SOUNDEFFECT_V2_PROFILE,
  pollComfyUiMossSound,
} from '@/lib/ai-providers/comfyui/moss'
import { COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY } from '@/lib/ai-providers/comfyui/models'
import type { AiProviderSoundExecutionContext } from '@/lib/ai-providers/runtime-types'
import { startScenarioServer } from '../helpers/fakes/scenario-server'

const PROMPT_ID = '00000000-0000-4000-8000-000000000002'

const soundInput: AiProviderSoundExecutionContext = {
  userId: 'user-moss-contract',
  selection: {
    provider: 'comfyui',
    modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID,
    modelKey: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY,
    variantSubKind: 'official',
  },
  prompt: 'Rain on a metal roof in a small cabin, close stereo perspective, irregular natural drops and distant thunder.',
  options: {
    negativePrompt: 'music, speech, singing, rhythmic loop',
    durationSeconds: 5,
    outputFormat: 'mp3',
  },
}

describe('ComfyUI MOSS SoundEffect v2 contract', () => {
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

  function defineValidPreflight() {
    for (const className of MOSS_SOUNDEFFECT_V2_PROFILE.requiredNodeClasses) {
      const required = className === 'MOSS_SoundEffectV2Loader'
        ? { model: ['COMBO', { options: ['OpenMOSS-Team/MOSS-SoundEffect-v2.0'] }] }
        : {}
      server!.defineScenario({
        method: 'GET',
        path: `/object_info/${encodeURIComponent(className)}`,
        mode: 'success',
        submitResponse: { status: 200, body: { [className]: { input: { required } } } },
      })
    }
  }

  it('compiles the checked-in API graph without UI-only prompt nodes or references', () => {
    const result = buildMossSoundEffectPromptGraph({
      prompt: soundInput.prompt,
      negativePrompt: soundInput.options?.negativePrompt,
      durationSeconds: 5,
      seed: 42,
    })
    expect(new Set(Object.values(result.graph).map((node) => node.class_type))).toEqual(new Set([
      'MOSS_SoundEffectV2Loader',
      'MOSS_SoundEffectV2Generate',
      'SaveAudioMP3',
    ]))
    expect(result.graph['29']?.inputs).toMatchObject({
      model: 'OpenMOSS-Team/MOSS-SoundEffect-v2.0',
      auto_download: false,
      local_files_only: true,
      disable_torch_compile: true,
    })
    expect(result.graph['30']?.inputs).toMatchObject({
      prompt: soundInput.prompt,
      negative_prompt: soundInput.options?.negativePrompt,
      seconds: 5,
      append_duration_suffix: false,
      preview: false,
    })
    expect(result.graph['30']?.inputs).not.toHaveProperty('references')
  })

  it('submits through the shared ComfyUI prompt protocol and returns SOUND external id', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    defineValidPreflight()
    server!.defineScenario({
      method: 'POST',
      path: '/prompt',
      mode: 'success',
      submitResponse: { status: 200, body: { prompt_id: PROMPT_ID } },
    })

    await expect(executeComfyUiMossSoundGeneration(soundInput)).resolves.toMatchObject({
      success: true,
      async: true,
      externalId: `COMFYUI:SOUND:${PROMPT_ID}`,
    })
    expect(server!.getRequests('POST', '/prompt')).toHaveLength(1)
  })

  it('reads an MP3 output through the shared job and /view protocol', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    server!.defineScenario({
      method: 'GET',
      path: `/api/jobs/${PROMPT_ID}`,
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { status: 'completed', outputs: { '28': { audio: [{ filename: 'sound.mp3', subfolder: '', type: 'output' }] } } },
      },
    })
    server!.defineScenario({
      method: 'GET',
      path: '/view',
      mode: 'success',
      submitResponse: { status: 200, headers: { 'content-type': 'audio/mpeg' }, body: 'mp3 bytes' },
    })

    const result = await pollComfyUiMossSound(PROMPT_ID)
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('MOSS_RESULT_NOT_COMPLETED')
    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/u)
  })
})
