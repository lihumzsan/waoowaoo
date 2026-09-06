import { describe, expect, it } from 'vitest'
import {
  freezeAudioExecution,
  musicGenerationModeForAudioExecution,
  parseFrozenAudioExecution,
} from '@/lib/workspace-resource/audio-execution-contract'
import { workspaceResourceGenerationTaskPayloadSchema } from '@/lib/workspace-resource/generation-contract'
import {
  compositionPlanMusicGenerationItemSchema,
  promptMusicGenerationItemSchema,
  soundGenerationItemSchema,
} from '@/lib/workspace-resource/generation-request'

describe('frozen workspace audio execution contract', () => {
  const promptMusicBase = {
    itemId: 'voice',
    name: 'Voice',
    mediaType: 'audio' as const,
    audioKind: 'music' as const,
    schemaId: 'project.bgm_audio' as const,
    prompt: 'A restrained vocal performance.',
    durationSeconds: 26,
    count: 1,
  }

  it('requires non-whitespace lyrics for vocal prompt music', () => {
    expect(promptMusicGenerationItemSchema.safeParse({
      ...promptMusicBase,
      vocalMode: 'vocal',
    }).success).toBe(false)
    expect(promptMusicGenerationItemSchema.safeParse({
      ...promptMusicBase,
      vocalMode: 'vocal',
      lyrics: '   \n\t',
    }).success).toBe(false)
  })

  it('preserves the exact vocal lyrics string in the frozen generation options', () => {
    const lyrics = ' [Verse]\n  Keep these spaces. \n'
    const item = promptMusicGenerationItemSchema.parse({
      ...promptMusicBase,
      vocalMode: 'vocal',
      lyrics,
    })

    expect(item.lyrics).toBe(lyrics)
    if (item.lyrics === undefined) throw new Error('Expected parsed vocal lyrics.')
    const frozen = freezeAudioExecution({
      item,
      generationOptions: {
        durationSeconds: 26,
        vocalMode: 'vocal',
        lyrics: item.lyrics,
        outputFormat: 'mp3',
      },
    })
    expect(frozen.mode).toBe('prompt_music')
    if (frozen.mode !== 'prompt_music') throw new Error('Expected frozen prompt music.')
    expect(frozen.generationOptions.lyrics).toBe(lyrics)
  })

  it('forbids caller-supplied lyrics for instrumental prompt music', () => {
    expect(promptMusicGenerationItemSchema.safeParse({
      ...promptMusicBase,
      vocalMode: 'instrumental',
      lyrics: '[Instrumental]',
    }).success).toBe(false)
  })

  it('freezes sound prompt, duration, and negative prompt without music score fields', () => {
    const item = soundGenerationItemSchema.parse({
      itemId: 'rain',
      name: 'Rain',
      mediaType: 'audio',
      audioKind: 'sound',
      schemaId: 'project.sound_effect_audio',
      prompt: 'Dense rain on a metal roof.',
      durationSeconds: 12,
      negativePrompt: 'music, speech',
      count: 1,
    })
    const frozen = freezeAudioExecution({
      item,
      generationOptions: {
        durationSeconds: 12,
        negativePrompt: 'music, speech',
        outputFormat: 'mp3',
      },
    })
    expect(frozen).toEqual({
      mode: 'sound',
      audioKind: 'sound',
      prompt: item.prompt,
      durationSeconds: 12,
      generationOptions: {
        durationSeconds: 12,
        negativePrompt: 'music, speech',
        outputFormat: 'mp3',
      },
    })
    expect(frozen.generationOptions).not.toHaveProperty('kind')
    expect(frozen.generationOptions).not.toHaveProperty('compositionPlan')
  })

  it('keeps prompt music distinct from composition music', () => {
    const item = promptMusicGenerationItemSchema.parse({
      itemId: 'pulse',
      name: 'Pulse',
      mediaType: 'audio',
      audioKind: 'music',
      schemaId: 'project.bgm_audio',
      prompt: 'A restrained metallic pulse.',
      durationSeconds: 26,
      vocalMode: 'instrumental',
      count: 1,
    })
    expect(freezeAudioExecution({
      item,
      generationOptions: {
        durationSeconds: 26,
        vocalMode: 'instrumental',
        outputFormat: 'mp3',
      },
    })).toMatchObject({
      mode: 'prompt_music',
      prompt: item.prompt,
      durationSeconds: 26,
    })
  })

  it('maps frozen prompt music to the required provider preflight mode', () => {
    const frozen = parseFrozenAudioExecution({
      audioExecutionMode: 'prompt_music',
      audioKind: 'music',
      prompt: 'A restrained metallic pulse.',
      durationSeconds: 26,
      generationOptions: {
        durationSeconds: 26,
        vocalMode: 'instrumental',
        outputFormat: 'mp3',
      },
    })

    expect(musicGenerationModeForAudioExecution(frozen.mode)).toBe('prompt')
  })

  it('accepts music_score_v1 only for composition music', () => {
    const compositionPlan = {
      chunks: [{
        text: 'Low drone.',
        durationMs: 6_000,
        positiveStyles: ['dark ambient'],
        negativeStyles: ['vocals'],
        contextAdherence: 'high' as const,
      }],
    }
    const item = compositionPlanMusicGenerationItemSchema.parse({
      itemId: 'score',
      name: 'Score',
      mediaType: 'audio',
      audioKind: 'music',
      schemaId: 'project.bgm_audio',
      compositionPlan,
      startMs: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      gainDb: 0,
      references: [{
        resourceId: 'timeline',
        contentVersion: 1,
        role: 'score_timeline',
        channel: 'context',
      }],
      count: 1,
    })
    const frozen = freezeAudioExecution({
      item,
      generationOptions: {
        kind: 'music_score_v1',
        compositionPlan,
        startMs: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        gainDb: 0,
        timelineInputPosition: 0,
        outputFormat: 'mp3',
      },
    })
    expect(frozen).toMatchObject({
      mode: 'composition_music',
      prompt: null,
      durationSeconds: null,
    })
  })

  it('rejects a persisted mode that conflicts with audioKind or frozen fields', () => {
    expect(() => parseFrozenAudioExecution({
      audioExecutionMode: 'composition_music',
      audioKind: 'sound',
      prompt: 'Rain.',
      durationSeconds: 5,
      generationOptions: {
        durationSeconds: 5,
        outputFormat: 'mp3',
      },
    })).toThrow()
  })

  it('reports frozen sound duration conflicts at the durable duration field', () => {
    const result = workspaceResourceGenerationTaskPayloadSchema.safeParse({
      lifecycleProjection: {
        resources: [{
          resourceId: 'sound-rain',
          mediaType: 'audio',
          schemaId: 'project.sound_effect_audio',
          name: 'Rain',
        }],
      },
      protocol: 'workspace_resource_generation_v2',
      audioExecutionMode: 'sound',
      resource: {
        resourceId: 'sound-rain',
        workspacePath: 'Rain-sound-rain',
        mediaType: 'audio',
        audioKind: 'sound',
        schemaId: 'project.sound_effect_audio',
        inputHash: 'a'.repeat(64),
        prompt: 'Rain on a metal roof.',
        modelKey: 'test::sound-provider',
        inputs: [],
        imageInputPositions: [],
        audioInputPositions: [],
        videoInputPositions: [],
        toolCallId: null,
        sourceTurnId: null,
      },
      soundModel: 'test::sound-provider',
      durationSeconds: 6,
      count: 1,
      generationOptions: {
        durationSeconds: 5,
        outputFormat: 'mp3',
      },
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['durationSeconds'],
      message: 'Sound duration must match frozen generationOptions.',
    }))
  })
})
