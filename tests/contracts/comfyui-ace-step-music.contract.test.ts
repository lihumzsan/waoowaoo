import { describe, expect, it } from 'vitest'
import {
  ACE_STEP_1_5_PROFILE,
  buildAceStepMusicPromptGraph,
  buildMiniMaxMusic3PromptGraph,
  COMFYUI_MUSIC_PROFILES,
  resolveComfyUiMusicProfile,
  resolveAceStepDurationPlan,
} from '@/lib/ai-providers/comfyui/music-profiles'
import { normalizeAiOptions } from '@/lib/ai-exec/normalize'
import {
  COMFYUI_ACE_STEP_1_5_MODEL_ID,
  COMFYUI_ACE_STEP_1_5_MODEL_KEY,
  COMFYUI_ACE_STEP_DEFAULT_GENERATION_OPTIONS,
  COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
} from '@/lib/ai-providers/comfyui/models'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { resolveAsyncTaskProviderByExternalId } from '@/lib/ai-providers'
import { promptMusicGenerationItemSchema } from '@/lib/workspace-resource/generation-request'
import { workspaceResourceGenerationTaskPayloadSchema } from '@/lib/workspace-resource/generation-contract'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { resolveMusicArtifactPlan } from '@/lib/task/execution/artifacts/music'

describe('ComfyUI music profile wire contract', () => {
  it('maps the verified MiniMax workflow to the active nine-node audio path', () => {
    const prompt = '  Global Metadata: restrained cinematic ambient.\nVocal Details: soft.  '
    const lyrics = '  [Verse]\nA quiet line\n  '
    const graph = buildMiniMaxMusic3PromptGraph({ prompt, lyrics, durationSeconds: 60, seed: 4242 })
    expect(Object.keys(graph).sort()).toEqual(['107', '41', '42', '43', '44', '45', '46', '47', '48'])
    expect(graph['41']).toEqual({ class_type: 'UNETLoader', inputs: {
      unet_name: 'MiniMax-Music-3\\minimax_music3_dit_fp16.safetensors', weight_dtype: 'default',
    } })
    expect(graph['43']).toEqual({ class_type: 'CLIPLoader', inputs: {
      clip_name: 'Minimax-music-3\\minimax_music3_text_encoder_bf16.safetensors', type: 'minimax', device: 'default',
    } })
    expect(graph['44']).toEqual({ class_type: 'VAELoader', inputs: {
      vae_name: 'MiniMax-Music-3\\minimax_music3_dav.safetensors',
    } })
    expect(graph['42']).toEqual({ class_type: 'MiniMaxMusic3TextEncode', inputs: {
      clip: ['43', 0], caption: prompt, lyrics, max_duration: 60, seed: 4242, cfg_scale: 1.7, top_k: 50,
    } })
    expect(graph['45']).toEqual({ class_type: 'ConditioningZeroOut', inputs: { conditioning: ['42', 0] } })
    expect(graph['46']).toEqual({ class_type: 'EmptyMiniMaxMusic3LatentAudio', inputs: {
      seconds: ['42', 1], batch_size: 1,
    } })
    expect(graph['47']).toEqual({ class_type: 'KSampler', inputs: {
      model: ['41', 0], positive: ['42', 0], negative: ['45', 0], latent_image: ['46', 0],
      seed: 4242, steps: 30, cfg: 1.7, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    } })
    expect(graph['48']).toEqual({ class_type: 'VAEDecodeAudio', inputs: { samples: ['47', 0], vae: ['44', 0] } })
    expect(graph['107']).toMatchObject({ class_type: 'SaveAudioAdvanced', inputs: {
      audio: ['48', 0], format: 'mp3', 'format.quality': 'V0',
    } })
  })

  it('rejects inconsistent selection identities for every production music profile', () => {
    for (const profile of COMFYUI_MUSIC_PROFILES) {
      const selection = { provider: 'comfyui', modelId: profile.modelId, modelKey: profile.modelKey, variantSubKind: 'official' as const }
      expect(resolveComfyUiMusicProfile(selection)).toBe(profile)
      for (const mutation of [{ provider: 'other' }, { modelId: 'unknown' }, { modelKey: 'comfyui::unknown' }]) {
        expect(() => resolveComfyUiMusicProfile({ ...selection, ...mutation })).toThrow()
      }
    }
  })

  it('validates MiniMax vocals before mapping exact lyrics and instrumental control text', () => {
    const profile = resolveComfyUiMusicProfile({ provider: 'comfyui', modelId: 'minimax-music-3', modelKey: 'comfyui::minimax-music-3', variantSubKind: 'official' })
    const options = { durationSeconds: 60, vocalMode: 'vocal', outputFormat: 'mp3', lyrics: '  [Verse]\nA quiet line  ' }
    const normalize = (candidate: Record<string, unknown>) => normalizeAiOptions({ schema: profile.optionSchema, options: candidate, context: profile.modelKey })
    expect(normalize(options)?.lyrics).toBe(options.lyrics)
    const built = profile.buildGraph({ prompt: 'Caption', options, seed: 42 })
    expect(built.graph['42']?.inputs.lyrics).toBe(options.lyrics)
    expect(profile.buildGraph({ prompt: 'Caption', options: { durationSeconds: 1, vocalMode: 'instrumental', outputFormat: 'mp3' }, seed: 42 }).graph['42']?.inputs.lyrics).toBe('[Instrumental]')
    for (const invalid of [
      { ...options, lyrics: undefined }, { ...options, lyrics: '  ' },
      { ...options, vocalMode: 'instrumental' }, { ...options, durationSeconds: 0 },
      { ...options, durationSeconds: 361 }, { ...options, durationSeconds: 1.5 },
      { ...options, outputFormat: 'wav' },
    ]) expect(() => normalize(invalid)).toThrow()
    for (const unsupported of ['negativePrompt', 'genre', 'mood', 'bpm', 'keyScale', 'timeSignature', 'referenceVideos', 'seed']) {
      expect(() => normalize({ ...options, [unsupported]: 'unsupported' })).toThrow()
    }
    expect(normalize({ ...options, durationSeconds: 360 })).toBeDefined()
  })
})

describe('ComfyUI ACE-Step 1.5 music contract', () => {
  it('maps one frozen instrumental cue to the verified API graph without rewriting it', () => {
    const prompt = '  Sparse bowed metal, low frame drum, one stable pulse; restrained tension.  '
    const result = buildAceStepMusicPromptGraph({
      prompt,
      requestedDurationSeconds: 6,
      bpm: 72,
      keyScale: 'D minor',
      timeSignature: '4',
      seed: 4242,
    })

    expect(result.durationPlan).toEqual({
      requestedDurationSeconds: 6,
      providerDurationSeconds: 10,
      requiresTrim: true,
    })
    expect(result.graph['94']?.inputs).toMatchObject({
      tags: prompt,
      lyrics: '[Instrumental]',
      language: 'unknown',
      bpm: 72,
      keyscale: 'D minor',
      timesignature: '4',
      duration: 10,
      seed: 4242,
      generate_audio_codes: true,
    })
    expect(result.graph['98']?.inputs).toMatchObject({ seconds: 10, batch_size: 1 })
    expect(result.graph['3']?.inputs).toMatchObject({
      seed: 4242,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
    })
    expect(result.graph['107']?.class_type).toBe('SaveAudioAdvanced')
    expect(result.graph['107']?.inputs).toMatchObject({
      filename_prefix: 'waoowaoo/ace-step-1.5',
      format: 'mp3',
      'format.quality': 'V0',
    })
  })

  it('uses the requested duration at and above the model floor', () => {
    expect(resolveAceStepDurationPlan(10)).toEqual({
      requestedDurationSeconds: 10,
      providerDurationSeconds: 10,
      requiresTrim: false,
    })
    expect(resolveAceStepDurationPlan(600)).toEqual({
      requestedDurationSeconds: 600,
      providerDurationSeconds: 600,
      requiresTrim: false,
    })
  })

  it('plans deterministic short-cue trimming and a bounded final fade', () => {
    expect(resolveMusicArtifactPlan({
      requestedDurationSeconds: 4,
      providerDurationSeconds: 10,
    })).toEqual({
      requestedDurationSeconds: 4,
      providerDurationSeconds: 10,
      requiresTrim: true,
      fadeDurationSeconds: 0.5,
      fadeStartSeconds: 3.5,
    })
    expect(resolveMusicArtifactPlan({
      requestedDurationSeconds: 10,
      providerDurationSeconds: 10,
    })).toEqual({
      requestedDurationSeconds: 10,
      providerDurationSeconds: 10,
      requiresTrim: false,
      fadeDurationSeconds: 0,
      fadeStartSeconds: 10,
    })
  })

  it('contains only the production nodes required by the ACE profile', () => {
    const classes = new Set(Object.values(ACE_STEP_1_5_PROFILE.workflow).map((node) => node.class_type))
    expect(classes).toEqual(new Set([
      'UNETLoader',
      'DualCLIPLoader',
      'VAELoader',
      'ModelSamplingAuraFlow',
      'TextEncodeAceStepAudio1.5',
      'EmptyAceStep1.5LatentAudio',
      'ConditioningZeroOut',
      'KSampler',
      'VAEDecodeAudio',
      'SaveAudioAdvanced',
    ]))
  })

  it('requires every ACE musical decision before provider execution', () => {
    const selection = {
      provider: 'comfyui' as const,
      modelId: COMFYUI_ACE_STEP_1_5_MODEL_ID,
      modelKey: COMFYUI_ACE_STEP_1_5_MODEL_KEY,
      variantSubKind: 'official' as const,
    }
    const complete = {
      durationSeconds: 4,
      vocalMode: 'instrumental',
      bpm: 72,
      keyScale: 'D minor',
      timeSignature: '4',
      outputFormat: 'mp3',
    }
    expect(normalizeMediaOptionsForSelection({
      selection,
      modality: 'music',
      musicGenerationMode: 'prompt',
      options: complete,
    })).toEqual({
      ...complete,
      providerDurationSeconds: 10,
    })
    for (const missing of ['bpm', 'keyScale', 'timeSignature'] as const) {
      const incomplete = { ...complete }
      delete incomplete[missing]
      expect(() => normalizeMediaOptionsForSelection({
        selection,
        modality: 'music',
        musicGenerationMode: 'prompt',
        options: incomplete,
      })).toThrow()
    }
    expect(() => normalizeMediaOptionsForSelection({
      selection,
      modality: 'music',
      musicGenerationMode: 'prompt',
      options: { ...complete, vocalMode: 'vocal' },
    })).toThrow()
  })

  it('registers the local model and parses its MUSIC external identity', () => {
    expect(COMFYUI_ACE_STEP_DEFAULT_GENERATION_OPTIONS).toEqual({ outputFormat: 'mp3' })
    const entry = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((candidate) => (
      candidate.modelType === 'music' && candidate.modelId === COMFYUI_ACE_STEP_1_5_MODEL_ID
    ))
    expect(entry).toMatchObject({
      provider: 'comfyui',
      capabilities: {
        music: {
          durationSecondsRange: { min: 4, max: 600 },
          vocalModeOptions: ['instrumental'],
          outputFormatOptions: ['mp3'],
          bpmRange: { min: 20, max: 300 },
          keyScaleOptions: expect.arrayContaining(['C major', 'C minor', 'D minor']),
          timeSignatureOptions: ['2', '3', '4', '6'],
        },
      },
    })
    const parsed = resolveAsyncTaskProviderByExternalId('COMFYUI:shared:MUSIC:00000000-0000-4000-8000-000000000004')
      .parseExternalId('COMFYUI:shared:MUSIC:00000000-0000-4000-8000-000000000004')
    expect(parsed).toEqual({
      provider: 'COMFYUI',
      endpoint: 'shared',
      type: 'MUSIC',
      requestId: '00000000-0000-4000-8000-000000000004',
    })
  })

  it('freezes key scale and time signature in the durable music payload', () => {
    const item = promptMusicGenerationItemSchema.parse({
      itemId: 'music-cue-1',
      name: 'Tension cue',
      folderPath: null,
      mediaType: 'audio',
      audioKind: 'music',
      prompt: 'Sparse bowed metal and low frame drum with one stable pulse.',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
      durationSeconds: 6,
      vocalMode: 'instrumental',
      bpm: 72,
      keyScale: 'D minor',
      timeSignature: '4',
    })
    expect(item).toMatchObject({ bpm: 72, keyScale: 'D minor', timeSignature: '4' })

    const payload = workspaceResourceGenerationTaskPayloadSchema.parse({
      lifecycleProjection: {
        resources: [{
          resourceId: 'music-cue-1', mediaType: 'audio',
          schemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO, name: 'Tension cue',
        }],
      },
      protocol: 'workspace_resource_generation_v2',
      audioExecutionMode: 'prompt_music',
      resource: {
        resourceId: 'music-cue-1', workspacePath: 'Tension-cue-music-cue-1', mediaType: 'audio', audioKind: 'music',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO, inputHash: 'b'.repeat(64),
        prompt: item.prompt, modelKey: COMFYUI_ACE_STEP_1_5_MODEL_KEY,
        inputs: [], imageInputPositions: [], audioInputPositions: [], videoInputPositions: [],
        toolCallId: null, sourceTurnId: null,
      },
      musicModel: COMFYUI_ACE_STEP_1_5_MODEL_KEY,
      durationSeconds: 6,
      count: 1,
      generationOptions: {
        durationSeconds: 6,
        vocalMode: 'instrumental',
        bpm: 72,
        keyScale: 'D minor',
        timeSignature: '4',
        outputFormat: 'mp3',
      },
    })
    expect(payload.audioExecutionMode).toBe('prompt_music')
    expect(payload.generationOptions).toMatchObject({ keyScale: 'D minor', timeSignature: '4' })
  })
})
