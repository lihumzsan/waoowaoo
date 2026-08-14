import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { buildVideoMergeInputHash } from '@/lib/operations/domains/workspace-resource/video-merge-ops'
import { parseWorkspaceResourceVideoMergeTaskPayload } from '@/lib/workspace-resource/video-merge-contract'

const video = (resourceId: string) => ({ resourceId, contentVersion: 1 })
const audio = { resourceId: 'audio_one', contentVersion: 1 }

describe('merge_videos audio mode contract', () => {
  const operation = createProjectAgentOperationRegistryForApi().merge_videos
  if (!operation) throw new Error('merge_videos operation missing')

  it.each([
    ['preserve', { name: 'preserved', videos: [video('video_one'), video('video_two')], audioMode: 'preserve' }],
    ['mix', { name: 'mixed', videos: [video('video_one')], audioMode: 'mix', backgroundMusic: audio }],
    ['replace', { name: 'replaced', videos: [video('video_one')], audioMode: 'replace', replacementAudio: audio }],
    ['mute', { name: 'muted', videos: [video('video_one')], audioMode: 'mute' }],
  ])('accepts the %s mode', (_mode, input) => {
    expect(operation.inputSchema.safeParse(input).success).toBe(true)
  })

  it('accepts exact environment sound cues on one preserved video timeline', () => {
    expect(operation.inputSchema.safeParse({
      name: 'timed ambience',
      videos: [video('video_one')],
      audioMode: 'preserve',
      soundCues: [{
        resourceId: 'sound_one',
        contentVersion: 1,
        startMs: 0,
        durationMs: 26_000,
        fadeInMs: 300,
        fadeOutMs: 500,
        gainDb: -8,
      }],
    }).success).toBe(true)
  })

  it.each([
    ['missing mode', { name: 'missing', videos: [video('video_one'), video('video_two')] }],
    ['legacy music field', { name: 'legacy', videos: [video('video_one')], audioMode: 'replace', music: audio }],
    ['generic audio field', { name: 'generic', videos: [video('video_one')], audioMode: 'replace', audio }],
    ['preserve with one video', { name: 'single-preserve', videos: [video('video_one')], audioMode: 'preserve' }],
    ['preserve with background music', { name: 'preserve-audio', videos: [video('video_one'), video('video_two')], audioMode: 'preserve', backgroundMusic: audio }],
    ['mix without background music', { name: 'mix-no-audio', videos: [video('video_one')], audioMode: 'mix' }],
    ['mix with replacement audio', { name: 'mix-replacement', videos: [video('video_one')], audioMode: 'mix', replacementAudio: audio }],
    ['replace without replacement audio', { name: 'replace-no-audio', videos: [video('video_one')], audioMode: 'replace' }],
    ['replace with background music', { name: 'replace-bgm', videos: [video('video_one')], audioMode: 'replace', backgroundMusic: audio }],
    ['mute with replacement audio', { name: 'mute-audio', videos: [video('video_one')], audioMode: 'mute', replacementAudio: audio }],
  ])('rejects %s', (_caseName, input) => {
    expect(operation.inputSchema.safeParse(input).success).toBe(false)
  })

  it('freezes the selected mode and explicit replacement-audio role into the task protocol', () => {
    const parsed = parseWorkspaceResourceVideoMergeTaskPayload({
      lifecycleProjection: { resources: [{
        resourceId: 'output_one',
        mediaType: 'video',
        schemaId: 'generic.video',
        name: 'Replaced output',
      }] },
      protocol: 'workspace_resource_video_merge_v2',
      resource: {
        resourceId: 'output_one',
        mediaType: 'video',
        schemaId: 'generic.video',
        prompt: null,
        modelKey: null,
        inputHash: 'a'.repeat(64),
        inputs: [
          { resourceId: 'video_one', contentVersion: 1, workspacePath: 'video-one.mp4', role: 'source_video', position: 0 },
          { resourceId: 'audio_one', contentVersion: 1, workspacePath: 'audio-one.mp3', role: 'replacement_audio', position: 1 },
        ],
        generationOptions: { mergeMode: 'ordered_concat', audioMode: 'replace' },
        toolCallId: null,
      },
    })

    expect(parsed.protocol).toBe('workspace_resource_video_merge_v2')
    expect(parsed.resource.generationOptions.audioMode).toBe('replace')
    expect(parsed.resource.inputs[1]?.role).toBe('replacement_audio')
  })

  it('gives different idempotency identities to different audio modes', () => {
    const references = [
      { resourceId: 'video_one', contentVersion: 1, workspacePath: 'video-one.mp4', role: 'source_video', position: 0 },
      { resourceId: 'audio_one', contentVersion: 1, workspacePath: 'audio-one.mp3', role: 'replacement_audio', position: 1 },
    ] as const

    expect(buildVideoMergeInputHash(references, 'mix')).not.toBe(
      buildVideoMergeInputHash(references, 'replace'),
    )
  })

  it('freezes sound cues separately from background music cue positions', () => {
    const payload = {
      lifecycleProjection: { resources: [{
        resourceId: 'output_one',
        mediaType: 'video',
        schemaId: 'generic.video',
        name: 'Timed output',
      }] },
      protocol: 'workspace_resource_video_merge_v2',
      resource: {
        resourceId: 'output_one',
        mediaType: 'video',
        schemaId: 'generic.video',
        prompt: null,
        modelKey: null,
        inputHash: 'a'.repeat(64),
        inputs: [
          { resourceId: 'video_one', contentVersion: 1, workspacePath: 'video-one.mp4', role: 'source_video', position: 0 },
          { resourceId: 'sound_one', contentVersion: 1, workspacePath: 'rain.mp3', role: 'sound_effect_audio', position: 1 },
        ],
        generationOptions: { mergeMode: 'timed_cues', audioMode: 'preserve' },
        musicCues: [],
        soundCues: [{ inputPosition: 1, startMs: 0, durationMs: 26_000, fadeInMs: 300, fadeOutMs: 500, gainDb: -8 }],
        toolCallId: null,
      },
    }

    const parsed = parseWorkspaceResourceVideoMergeTaskPayload(payload)
    expect(parsed.protocol).toBe('workspace_resource_video_merge_v2')
    expect(parsed.resource.soundCues).toHaveLength(1)

    expect(() => parseWorkspaceResourceVideoMergeTaskPayload({
      ...payload,
      resource: {
        ...payload.resource,
        inputs: [
          payload.resource.inputs[0],
          { ...payload.resource.inputs[1], role: 'bgm_audio' },
        ],
      },
    })).toThrow(/soundCues/)
  })

  it('rejects a timed audio input without a matching frozen cue', () => {
    expect(() => parseWorkspaceResourceVideoMergeTaskPayload({
      lifecycleProjection: { resources: [{
        resourceId: 'output_one',
        mediaType: 'video',
        schemaId: 'generic.video',
        name: 'Output',
      }] },
      protocol: 'workspace_resource_video_merge_v2',
      resource: {
        resourceId: 'output_one',
        mediaType: 'video',
        schemaId: 'generic.video',
        prompt: null,
        modelKey: null,
        inputHash: 'a'.repeat(64),
        inputs: [
          { resourceId: 'video_one', contentVersion: 1, workspacePath: 'video-one.mp4', role: 'source_video', position: 0 },
          { resourceId: 'video_two', contentVersion: 1, workspacePath: 'video-two.mp4', role: 'source_video', position: 1 },
          { resourceId: 'sound_one', contentVersion: 1, workspacePath: 'rain.mp3', role: 'sound_effect_audio', position: 2 },
        ],
        generationOptions: { mergeMode: 'ordered_concat', audioMode: 'preserve' },
        musicCues: [],
        soundCues: [],
        toolCallId: null,
      },
    })).toThrow(/Timed audio inputs require matching frozen cues/)
  })
})
