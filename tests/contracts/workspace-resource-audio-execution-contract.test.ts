import { describe, expect, it } from 'vitest'
import {
  freezeAudioExecution,
  parseFrozenAudioExecution,
} from '@/lib/workspace-resource/audio-execution-contract'
import {
  compositionPlanMusicGenerationItemSchema,
  promptMusicGenerationItemSchema,
  soundGenerationItemSchema,
} from '@/lib/workspace-resource/generation-request'

describe('frozen workspace audio execution contract', () => {
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
})
