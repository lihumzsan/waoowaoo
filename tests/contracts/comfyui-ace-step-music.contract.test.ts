import { describe, expect, it } from 'vitest'
import {
  ACE_STEP_1_5_PROFILE,
  buildAceStepMusicPromptGraph,
  resolveAceStepDurationPlan,
} from '@/lib/ai-providers/comfyui/ace-step'
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
    const parsed = resolveAsyncTaskProviderByExternalId('COMFYUI:MUSIC:00000000-0000-4000-8000-000000000004')
      .parseExternalId('COMFYUI:MUSIC:00000000-0000-4000-8000-000000000004')
    expect(parsed).toEqual({
      provider: 'COMFYUI',
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
