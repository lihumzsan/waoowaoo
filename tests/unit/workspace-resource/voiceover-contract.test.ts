import { describe, expect, it } from 'vitest'
import {
  parseWorkspaceResourceVoiceoverMixTaskPayload,
  parseWorkspaceResourceVoiceoverTaskPayload,
} from '@/lib/workspace-resource/voiceover-contract'
import { handleWorkspaceResourceVoiceoverMixTask } from '@/lib/task/execution/handlers/workspace-resource-voiceover-mix'

const source = {
  resourceId: 'source-video',
  contentVersion: 3,
  workspacePath: 'video/source.mp4',
  role: 'source_video' as const,
  position: 0,
}

const reference = {
  resourceId: 'reference-audio',
  contentVersion: 2,
  workspacePath: 'audio/reference.mp3',
  role: 'reference_audio' as const,
  position: 0,
}

const narrationZero = {
  resourceId: 'narration-zero',
  contentVersion: 1,
  workspacePath: 'audio/narration-zero.mp3',
  role: 'voiceover_audio' as const,
  position: 0,
  startSeconds: 0,
}

const narrationOne = {
  resourceId: 'narration-one',
  contentVersion: 1,
  workspacePath: 'audio/narration-one.mp3',
  role: 'voiceover_audio' as const,
  position: 1,
  startSeconds: 4.25,
}

const bgm = {
  resourceId: 'bgm-audio',
  contentVersion: 5,
  workspacePath: 'audio/bgm.mp3',
  role: 'bgm_audio' as const,
  position: 0,
}

function narrationPayload(overrides: Record<string, unknown> = {}) {
  return {
    lifecycleProjection: {
      resources: [{ resourceId: 'narration-zero', mediaType: 'audio', schemaId: 'project.voiceover_audio', name: '旁白' }],
    },
    protocol: 'workspace_resource_voiceover_v1',
    resource: {
      resourceId: 'narration-zero',
      workspacePath: 'audio/narration-zero.mp3',
      mediaType: 'audio',
      schemaId: 'project.voiceover_audio',
      inputHash: 'b'.repeat(64),
      prompt: '第一段旁白',
      modelKey: 'comfyui::moss-tts-local-1.7b',
      inputs: [reference],
      toolCallId: null,
      sourceTurnId: 'turn-one',
    },
    voiceModel: 'comfyui::moss-tts-local-1.7b',
    referenceAudio: {
      resourceId: reference.resourceId,
      contentVersion: reference.contentVersion,
      workspacePath: reference.workspacePath,
    },
    text: '第一段旁白',
    language: 'zh',
    outputFormat: 'mp3',
    generationOptions: { language: 'zh', referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' },
    ...overrides,
  }
}

function payload(inputs: unknown[]) {
  return {
    lifecycleProjection: {
      resources: [{
        resourceId: 'mixed-video',
        mediaType: 'video',
        schemaId: 'generic.video',
        name: '旁白视频',
      }],
    },
    protocol: 'workspace_resource_voiceover_mix_v1',
    resource: {
      resourceId: 'mixed-video',
      mediaType: 'video',
      schemaId: 'generic.video',
      prompt: null,
      modelKey: null,
      inputHash: 'a'.repeat(64),
      inputs,
      generationOptions: { ducking: true, preserveSourceAudio: true },
      toolCallId: null,
    },
  }
}

describe('workspace Resource voiceover mix aggregate contract', () => {
  it.each([
    ['duplicate source video', [source, { ...source, resourceId: 'other-source' }, reference, narrationZero]],
    ['duplicate reference audio', [source, reference, { ...reference, resourceId: 'other-reference' }, narrationZero]],
    ['duplicate BGM audio', [source, reference, narrationZero, bgm, { ...bgm, resourceId: 'other-bgm' }]],
    ['missing narration', [source, reference]],
    ['non-contiguous narration positions', [source, reference, narrationZero, { ...narrationOne, position: 2 }]],
    ['duplicate narration positions', [source, reference, narrationZero, { ...narrationOne, position: 0 }]],
    ['missing narration start time', [source, reference, { ...narrationZero, startSeconds: undefined }]],
    ['source start time', [{ ...source, startSeconds: 0 }, reference, narrationZero]],
    ['reference start time', [source, { ...reference, startSeconds: 0 }, narrationZero]],
    ['BGM start time', [source, reference, narrationZero, { ...bgm, startSeconds: 0 }]],
    ['non-zero source position', [{ ...source, position: 1 }, reference, narrationZero]],
    ['non-zero reference position', [source, { ...reference, position: 1 }, narrationZero]],
    ['non-zero BGM position', [source, reference, narrationZero, { ...bgm, position: 1 }]],
  ])('rejects %s', (_label, inputs) => {
    expect(() => parseWorkspaceResourceVoiceoverMixTaskPayload(payload(inputs))).toThrow()
  })

  it('returns normalized roles with narrations ordered by position', () => {
    const parsed = parseWorkspaceResourceVoiceoverMixTaskPayload(payload([
      narrationOne,
      bgm,
      reference,
      narrationZero,
      source,
    ]))

    expect(parsed.inputAggregate).toEqual({
      source,
      reference,
      narrations: [narrationZero, narrationOne],
      bgm,
    })
  })

  it('accepts persisted runtime progress fields without leaking them into the normalized mix payload', () => {
    const parsed = parseWorkspaceResourceVoiceoverMixTaskPayload({
      ...payload([source, reference, narrationZero]),
      stage: 'voiceover_mix_prepare',
      externalId: 'external-mix-job',
    })

    expect(Object.hasOwn(parsed, 'stage')).toBe(false)
    expect(parsed.inputAggregate.narrations).toEqual([narrationZero])
  })

  it('accepts persisted runtime progress fields without leaking them into the narration payload', () => {
    const parsed = parseWorkspaceResourceVoiceoverTaskPayload(narrationPayload({
      stage: 'voiceover_polling_external',
      externalId: 'external-voice-job',
    }))

    expect(Object.hasOwn(parsed, 'stage')).toBe(false)
    expect(parsed.text).toBe('第一段旁白')
  })

  it.each([
    ['language drift', { language: 'en' }],
    ['output format drift', { outputFormat: 'wav', generationOptions: { language: 'zh', referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' } }],
    ['missing exact reference option', { generationOptions: { language: 'zh', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' } }],
    ['reference identity drift', { referenceAudio: { resourceId: 'other-reference', contentVersion: 2, workspacePath: 'audio/reference.mp3' } }],
    ['prompt drift', { text: '与冻结 prompt 不同的旁白' }],
    ['model drift', { voiceModel: 'comfyui::other-voice-model' }],
  ])('rejects narration payload %s', (_label, overrides) => {
    expect(() => parseWorkspaceResourceVoiceoverTaskPayload(narrationPayload(overrides))).toThrow()
  })

  it('rejects a cross-wired mix Task before resolving or writing media', async () => {
    await expect(handleWorkspaceResourceVoiceoverMixTask({
      data: {
        taskId: 'mix-task',
        type: 'workspace_resource_voiceover_mix',
        locale: 'zh',
        projectId: 'project-one',
        targetType: 'WorkspaceResource',
        targetId: 'different-video',
        payload: payload([source, reference, narrationZero]),
        userId: 'user-one',
      },
      attempt: 1,
      signal: new AbortController().signal,
      executionDeadlineMs: null,
      heartbeat: () => undefined,
    })).rejects.toThrow('WORKSPACE_RESOURCE_VOICEOVER_MIX_TASK_CONTRACT_INVALID:mix-task')
  })
})
