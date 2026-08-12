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
      protocol: 'workspace_resource_video_merge_v1',
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

    expect(parsed.protocol).toBe('workspace_resource_video_merge_v1')
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
})
