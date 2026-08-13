import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceResourceVoiceoverMixInputIdentity,
  buildWorkspaceResourceVoiceoverInputIdentity,
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
  inputHash: 'f259853e19008fc217e3e5f35610b8def59d8d36e1ec4f06550b0fc9ac61fc00',
}

const narrationOne = {
  resourceId: 'narration-one',
  contentVersion: 1,
  workspacePath: 'audio/narration-one.mp3',
  role: 'voiceover_audio' as const,
  position: 1,
  startSeconds: 4.25,
  inputHash: '31c57596bb3911732828afdac952d9bf3b684c83e9089342f5770b9335488943',
}

const bgm = {
  resourceId: 'bgm-audio',
  contentVersion: 5,
  workspacePath: 'audio/bgm.mp3',
  role: 'bgm_audio' as const,
  position: 0,
}

function narrationPayload(overrides: Record<string, unknown> = {}) {
  const candidate = {
    lifecycleProjection: {
      resources: [{ resourceId: 'narration-zero', mediaType: 'audio', schemaId: 'project.voiceover_audio', name: '旁白' }],
    },
    protocol: 'workspace_resource_voiceover_v1',
    resource: {
      resourceId: 'narration-zero',
      workspacePath: 'audio/narration-zero.mp3',
      mediaType: 'audio',
      schemaId: 'project.voiceover_audio',
      inputHash: '698d76447e58fdbc164c436593cd70098843cf5ea0f7036db23cf4c8f3af3ee8',
      prompt: '第一段旁白',
      modelKey: 'comfyui::moss-tts-local-1.7b',
      inputs: [{ ...reference, position: 0 as const }],
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
    generationOptions: { language: 'zh' as const, referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' as const },
    ...overrides,
  }
  candidate.resource.inputHash = buildWorkspaceResourceVoiceoverInputIdentity({
    prompt: candidate.resource.prompt,
    modelKey: candidate.resource.modelKey,
    inputs: candidate.resource.inputs,
    generationOptions: candidate.generationOptions,
  })
  return candidate
}

function withProjectionResource(
  base: ReturnType<typeof narrationPayload>,
  projection: { resourceId: string; mediaType: 'audio' | 'video'; schemaId: string; name: string },
) {
  return { ...base, lifecycleProjection: { resources: [projection] } }
}

function payload(inputs: unknown[]) {
  const generationOptions = { ducking: true, preserveSourceAudio: true } as const
  const inputHash = buildWorkspaceResourceVoiceoverMixInputIdentity({
    inputs: inputs as Parameters<typeof buildWorkspaceResourceVoiceoverMixInputIdentity>[0]['inputs'],
    generationOptions,
  })
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
      inputHash,
      inputs,
      generationOptions,
      toolCallId: null,
    },
  }
}

describe('workspace Resource voiceover mix aggregate contract', () => {
  it.each([
    ['baseline', { language: 'zh', referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' }, 'f259853e19008fc217e3e5f35610b8def59d8d36e1ec4f06550b0fc9ac61fc00'],
    ['language', { language: 'en', referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' }, '31c57596bb3911732828afdac952d9bf3b684c83e9089342f5770b9335488943'],
    ['reference storage key', { language: 'zh', referenceAudio: 'media/reference-v2.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' }, '6cd47ed80b71671531fb671fdd9e6358a04e698e8f88c7255f016f589b9b14d0'],
    ['reference duration', { language: 'zh', referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 6_000, outputFormat: 'mp3' }, '23ebe103a340a5494513f2a5786dcdaec6b66d42fcb507fa5677f86fc946962e'],
  ] as const)('includes normalized %s in the narration identity', (_label, generationOptions, expectedIdentity) => {
    const identity = buildWorkspaceResourceVoiceoverInputIdentity({
      prompt: 'Narration text',
      modelKey: 'comfyui::moss-tts-local-1.7b',
      inputs: [{ ...reference, position: 0 as const }],
      generationOptions,
    })
    expect(identity).toBe(expectedIdentity)
  })

  it('rejects a persisted narration hash that does not match its frozen execution facts', () => {
    const candidate = narrationPayload()
    candidate.resource.inputHash = 'b'.repeat(64)
    expect(() => parseWorkspaceResourceVoiceoverTaskPayload(candidate)).toThrow()
  })

  it('rejects a persisted mix hash that does not match its frozen execution graph', () => {
    const candidate = payload([
      source,
      reference,
      narrationZero,
    ])
    candidate.resource.inputHash = 'a'.repeat(64)
    expect(() => parseWorkspaceResourceVoiceoverMixTaskPayload(candidate)).toThrow()
  })

  it('rejects mix options that do not match the fixed execution policy', () => {
    const candidate = payload([source, reference, narrationZero])
    candidate.resource.generationOptions = { ducking: false, preserveSourceAudio: true } as never
    expect(() => parseWorkspaceResourceVoiceoverMixTaskPayload(candidate)).toThrow()
  })

  it('does not attribute the deterministic mix identity directly to a narration model', () => {
    type MixIdentityAcceptsModelKey = 'modelKey' extends keyof Parameters<typeof buildWorkspaceResourceVoiceoverMixInputIdentity>[0] ? true : false
    const acceptsModelKey: MixIdentityAcceptsModelKey = false
    const buildIdentity = buildWorkspaceResourceVoiceoverMixInputIdentity as unknown as (input: {
      modelKey?: string
      inputs: Parameters<typeof buildWorkspaceResourceVoiceoverMixInputIdentity>[0]['inputs']
      generationOptions: Parameters<typeof buildWorkspaceResourceVoiceoverMixInputIdentity>[0]['generationOptions']
    }) => string
    const inputs = [source, reference, narrationZero] as Parameters<typeof buildWorkspaceResourceVoiceoverMixInputIdentity>[0]['inputs']
    const generationOptions = { ducking: true, preserveSourceAudio: true } as const

    expect(acceptsModelKey).toBe(false)
    expect(buildIdentity({ modelKey: 'comfyui::moss-a', inputs, generationOptions })).toBe(
      buildIdentity({ modelKey: 'comfyui::moss-b', inputs, generationOptions }),
    )
  })

  it('projects narration and mix generation options through one normalized resource facts boundary', () => {
    const narration = parseWorkspaceResourceVoiceoverTaskPayload(narrationPayload()) as unknown as {
      resourceFacts?: { generationOptions: unknown }
    }
    const mix = parseWorkspaceResourceVoiceoverMixTaskPayload(payload([source, reference, narrationZero])) as unknown as {
      resourceFacts?: { generationOptions: unknown }
    }

    expect(narration.resourceFacts?.generationOptions).toEqual({
      language: 'zh',
      referenceAudio: 'media/reference.mp3',
      referenceAudioDurationMs: 5_000,
      outputFormat: 'mp3',
    })
    expect(mix.resourceFacts?.generationOptions).toEqual({ ducking: true, preserveSourceAudio: true })
  })

  it.each([
    ['narration', parseWorkspaceResourceVoiceoverTaskPayload, narrationPayload(), 'other-narration'],
    ['mix', parseWorkspaceResourceVoiceoverMixTaskPayload, payload([source, reference, narrationZero]), 'other-video'],
  ])('rejects a cross-wired %s Task target at the parser boundary', (_label, parser, candidate, targetId) => {
    const parseWithTarget = parser as unknown as (value: unknown, target: { targetType: string; targetId: string }) => unknown
    expect(() => parseWithTarget(candidate, { targetType: 'WorkspaceResource', targetId })).toThrow()
  })

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

  it.each([
    ['resource identity', { resourceId: 'other-narration', mediaType: 'audio' as const, schemaId: 'project.voiceover_audio', name: '旁白' }],
    ['media type', { resourceId: 'narration-zero', mediaType: 'video' as const, schemaId: 'project.voiceover_audio', name: '旁白' }],
    ['schema identity', { resourceId: 'narration-zero', mediaType: 'audio' as const, schemaId: 'generic.video', name: '旁白' }],
  ])('rejects narration lifecycle projection drift in %s', (_label, projection) => {
    expect(() => parseWorkspaceResourceVoiceoverTaskPayload(withProjectionResource(narrationPayload(), projection))).toThrow()
  })

  it.each([
    ['resource identity', { resourceId: 'other-mix', mediaType: 'video' as const, schemaId: 'generic.video', name: '旁白视频' }],
    ['media type', { resourceId: 'mixed-video', mediaType: 'audio' as const, schemaId: 'generic.video', name: '旁白视频' }],
    ['schema identity', { resourceId: 'mixed-video', mediaType: 'video' as const, schemaId: 'project.voiceover_audio', name: '旁白视频' }],
  ])('rejects mix lifecycle projection drift in %s', (_label, projection) => {
    const candidate = payload([source, reference, narrationZero])
    candidate.lifecycleProjection.resources = [projection]
    expect(() => parseWorkspaceResourceVoiceoverMixTaskPayload(candidate)).toThrow()
  })
})
