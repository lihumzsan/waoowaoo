import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceResourceVideoMergeTaskPayload } from '@/lib/workspace-resource/video-merge-contract'
import type { ResolvedWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { getObjectBuffer } from '@/lib/storage'
import {
  concatVideoMergeAudioClips,
  muxVideoMergeFinalAudio,
  muxVideoMergeTimedAudioCues,
  renderVideoMergeClipAudio,
} from './video-merge-audio'
import { resolveCompositionTiming } from './composition-timing'
import { createFfmpegCommandRunner } from './ffmpeg-command'
import { composeVideoMergeVideoTrack } from './video-merge-ffmpeg'

export async function renderMp4Composition(input: {
  payload: WorkspaceResourceVideoMergeTaskPayload
  sourcePaths: readonly string[]
  workspaceDir: string
  assemblyAudioStorageKey: string | null
  resolvedBgm: readonly ResolvedWorkspaceResourceInputMedia[]
  resolvedSound: readonly ResolvedWorkspaceResourceInputMedia[]
}): Promise<{
  buffer: Buffer
  width: number
  height: number
  durationMs: number
}> {
  const {
    payload,
    sourcePaths,
    workspaceDir,
    assemblyAudioStorageKey,
    resolvedBgm,
    resolvedSound,
  } = input
  const { composition, format } = payload.resource.generationOptions
  const dimensions = format
  const audioMode = composition.audio.mode
  const hasTimedAudioCues =
    payload.resource.musicCues.length + payload.resource.soundCues.length > 0
  const usesSourceAudio =
    hasTimedAudioCues || audioMode === 'preserve' || audioMode === 'mix'
  const timeline = resolveCompositionTiming(composition, format.frameRate)
  const { stitchedPath, encodedDurationMs } = await composeVideoMergeVideoTrack({
    sourcePaths,
    timeline,
    workspaceDir,
    width: dimensions.width,
    height: dimensions.height,
  })
  const audioPaths: string[] = []
  let hasSourceAudio = false
  for (const [index, sourcePath] of sourcePaths.entries()) {
    const clip = timeline.clips[index]!
    const durationSeconds = clip.durationMs / 1000
    if (usesSourceAudio) {
      const audioPath = path.join(workspaceDir, `audio-${String(index)}.wav`)
      const clipHasAudio = await renderVideoMergeClipAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'workspace_resource_video_merge_clip_audio',
          expectedDurationSeconds: durationSeconds,
        }),
        sourcePath,
        outputPath: audioPath,
        durationSeconds,
        sourceStartSeconds: clip.sourceStartMs / 1000,
      })
      hasSourceAudio = hasSourceAudio || clipHasAudio
      audioPaths.push(audioPath)
    }
  }

  const stitchedDurationSeconds = timeline.videoDurationUs / 1000000
  const mainAudioPath = usesSourceAudio
    ? path.join(workspaceDir, 'audio.wav')
    : null
  if (mainAudioPath) {
    await concatVideoMergeAudioClips({
      runCommand: createFfmpegCommandRunner({
        stage: 'workspace_resource_video_merge_concat_audio',
        expectedDurationSeconds: timeline.durationMs / 1000,
      }),
      clipAudioPaths: audioPaths,
      outputPath: mainAudioPath,
      durationSeconds: timeline.durationMs / 1000,
    })
  }
  const outputPath = path.join(workspaceDir, 'merged.mp4')
  if (hasTimedAudioCues) {
    if (!mainAudioPath)
      throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_MAIN_AUDIO_REQUIRED')
    const musicCues = await Promise.all(
      resolvedBgm.map(async (bgm, index) => {
        const placement = payload.resource.musicCues[index]
        if (!placement)
          throw new Error(
            `WORKSPACE_RESOURCE_VIDEO_MERGE_BGM_PLACEMENT_MISSING:${String(index)}`,
          )
        const musicPath = path.join(workspaceDir, `bgm-source-${String(index)}`)
        await writeFile(musicPath, await getObjectBuffer(bgm.storageKey))
        return { ...placement, audioPath: musicPath }
      }),
    )
    const soundCues = await Promise.all(
      resolvedSound.map(async (sound, index) => {
        const placement = payload.resource.soundCues[index]
        if (!placement)
          throw new Error(
            `WORKSPACE_RESOURCE_VIDEO_MERGE_SOUND_PLACEMENT_MISSING:${String(index)}`,
          )
        const soundPath = path.join(
          workspaceDir,
          `sound-source-${String(index)}`,
        )
        await writeFile(soundPath, await getObjectBuffer(sound.storageKey))
        return { ...placement, audioPath: soundPath }
      }),
    )
    await muxVideoMergeTimedAudioCues({
      runCommand: createFfmpegCommandRunner({
        stage: 'workspace_resource_video_merge_concat_audio',
        expectedDurationSeconds: stitchedDurationSeconds,
      }),
      stitchedPath,
      mainAudioPath,
      hasSourceAudio,
      musicCues,
      soundCues,
      outputPath,
      durationSeconds: stitchedDurationSeconds,
    })
  } else {
    const assemblyAudioPath = assemblyAudioStorageKey
      ? path.join(workspaceDir, 'assembly-audio-source')
      : null
    if (assemblyAudioPath && assemblyAudioStorageKey) {
      await writeFile(
        assemblyAudioPath,
        await getObjectBuffer(assemblyAudioStorageKey),
      )
    }
    await muxVideoMergeFinalAudio({
      runCommand: createFfmpegCommandRunner({
        stage: 'workspace_resource_video_merge_mux',
        expectedDurationSeconds: stitchedDurationSeconds,
      }),
      audioMode,
      stitchedPath,
      mainAudioPath,
      hasSourceAudio,
      assemblyAudioPath,
      outputPath,
      durationSeconds: stitchedDurationSeconds,
    })
  }
  return {
    buffer: await readFile(outputPath),
    width: dimensions.width,
    height: dimensions.height,
    durationMs: encodedDurationMs,
  }
}
