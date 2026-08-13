import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMossSoundEffectPromptGraph,
  executeComfyUiMossSoundGeneration,
  MOSS_SOUNDEFFECT_V2_PROFILE,
  pollComfyUiMossSound,
} from '@/lib/ai-providers/comfyui/moss'
import { COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY } from '@/lib/ai-providers/comfyui/models'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import type { AiProviderSoundExecutionContext } from '@/lib/ai-providers/runtime-types'
import { workspaceResourceGenerationTaskPayloadSchema } from '@/lib/workspace-resource/generation-contract'
import { soundGenerationItemSchema } from '@/lib/workspace-resource/generation-request'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
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

  it('keeps the declared one-to-thirty-second range at the provider-option boundary', () => {
    for (const durationSeconds of [1, 30]) {
      expect(normalizeMediaOptionsForSelection({
        selection: soundInput.selection,
        modality: 'sound',
        options: { durationSeconds, outputFormat: 'mp3' },
      })).toMatchObject({ durationSeconds })
    }
    for (const durationSeconds of [0, 31]) {
      expect(() => normalizeMediaOptionsForSelection({
        selection: soundInput.selection,
        modality: 'sound',
        options: { durationSeconds, outputFormat: 'mp3' },
      })).toThrow()
    }
  })

  it('preserves negative prompt whitespace at the generation request boundary', () => {
    const negativePrompt = '  music, speech, singing\n'
    const item = soundGenerationItemSchema.parse({
      itemId: 'sound-rain',
      name: 'Rain',
      folderPath: null,
      mediaType: 'audio',
      audioKind: 'sound',
      prompt: soundInput.prompt,
      schemaId: WORKSPACE_RESOURCE_SCHEMA.SOUND_EFFECT_AUDIO,
      durationSeconds: 5,
      negativePrompt,
    })
    const graph = buildMossSoundEffectPromptGraph({
      prompt: item.prompt,
      negativePrompt: item.negativePrompt,
      durationSeconds: item.durationSeconds,
      seed: 42,
    })

    expect(item.negativePrompt).toBe(negativePrompt)
    expect(graph.graph['30']?.inputs.negative_prompt).toBe(negativePrompt)
  })

  it('preserves negative prompt whitespace in the frozen task payload', () => {
    const negativePrompt = '\nno music or speech  '
    const payload = workspaceResourceGenerationTaskPayloadSchema.parse({
      lifecycleProjection: {
        resources: [{
          resourceId: 'sound-rain', mediaType: 'audio',
          schemaId: WORKSPACE_RESOURCE_SCHEMA.SOUND_EFFECT_AUDIO, name: 'Rain',
        }],
      },
      protocol: 'workspace_resource_generation_v2',
      resource: {
        resourceId: 'sound-rain', workspacePath: 'Rain-sound-rain', mediaType: 'audio', audioKind: 'sound',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.SOUND_EFFECT_AUDIO, inputHash: 'a'.repeat(64),
        prompt: soundInput.prompt, modelKey: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY,
        inputs: [], imageInputPositions: [], audioInputPositions: [], videoInputPositions: [],
        toolCallId: null, sourceTurnId: null,
      },
      soundModel: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY,
      durationSeconds: 5, outputFormat: 'mp3', count: 1, generationOptions: {}, negativePrompt,
    })

    expect(payload.negativePrompt).toBe(negativePrompt)
  })

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
      append_duration_suffix: true,
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

  it.each([401, 403, 404, 422])('classifies prompt HTTP %s as a typed rejection', async (status) => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    defineValidPreflight()
    server!.defineScenario({
      method: 'POST',
      path: '/prompt',
      mode: 'success',
      submitResponse: { status, body: { error: `reject-${String(status)}` } },
    })
    await expect(executeComfyUiMossSoundGeneration(soundInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'PROVIDER_SUBMISSION_REJECTED',
    })
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

  it('rejects output from another node or multiple node-28 audio files', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', server!.baseUrl)
    for (const outputs of [
      { '30': { audio: [{ filename: 'wrong.mp3', subfolder: '', type: 'output' }] } },
      { '28': { audio: [{ filename: 'one.mp3', subfolder: '', type: 'output' }, { filename: 'two.mp3', subfolder: '', type: 'output' }] } },
    ]) {
      server!.defineScenario({
        method: 'GET',
        path: `/api/jobs/${PROMPT_ID}`,
        mode: 'success',
        submitResponse: { status: 200, body: { status: 'completed', outputs } },
      })
      await expect(pollComfyUiMossSound(PROMPT_ID)).rejects.toThrow('COMFYUI_MOSS_AUDIO_OUTPUT_MISSING')
    }
  })
})
