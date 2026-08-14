import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseWorkspaceResourceVideoMergeTaskPayload } from '@/lib/workspace-resource/video-merge-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import {
  concatVideoMergeAudioClips,
  muxVideoMergeFinalAudio,
  muxVideoMergeTimedAudioCues,
  renderVideoMergeClipAudio,
} from '@/lib/video-compose/video-merge-audio'
import {
  createFfmpegCommandRunner,
  probeMediaDurationSeconds,
} from '@/lib/video-compose/ffmpeg-command'
import {
  composeVideoMergeVideoTrack,
  probeVideoDimensions,
} from '@/lib/video-compose/video-merge-ffmpeg'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive } from '../provider-media'

export async function handleWorkspaceResourceVideoMergeTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceVideoMergeTaskPayload(data.payload ?? {})
  if (payload.resource.resourceId !== data.targetId) {
    throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_TARGET_MISMATCH:${data.taskId}`)
  }
  const videoInputs = payload.resource.inputs.filter((input) => input.role === 'source_video')
  const resolvedVideos = await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: videoInputs,
    expectedMediaType: 'video',
  })
  const ordered = resolvedVideos.map((resource) => ({
    input: resource.reference,
    storageKey: resource.storageKey,
  }))
  const assemblyAudioInput = payload.resource.inputs.find((input) => (
    input.role === 'background_music' || input.role === 'replacement_audio'
  )) ?? null
  const [resolvedAssemblyAudio] = assemblyAudioInput ? await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: [assemblyAudioInput],
    expectedMediaType: 'audio',
  }) : []
  const assemblyAudioStorageKey = resolvedAssemblyAudio?.storageKey ?? null
  const audioMode = 'audioMode' in payload.resource.generationOptions
    && ['preserve', 'mix', 'replace', 'mute'].includes(String(payload.resource.generationOptions.audioMode))
    ? payload.resource.generationOptions.audioMode as 'preserve' | 'mix' | 'replace' | 'mute'
    : 'preserve'
  const hasTimedAudioCues = payload.resource.musicCues.length > 0 || payload.resource.soundCues.length > 0
  const usesSourceAudio = hasTimedAudioCues || audioMode === 'preserve' || audioMode === 'mix'
  const inputByPosition = new Map(payload.resource.inputs.map((input) => [input.position, input]))
  const bgmInputs = payload.resource.musicCues.map((cue) => {
    const reference = inputByPosition.get(cue.inputPosition)
    if (!reference || reference.role !== 'bgm_audio') {
      throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_BGM_POSITION_INVALID:${String(cue.inputPosition)}`)
    }
    return reference
  })
  const resolvedBgm = bgmInputs.length > 0 ? await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: bgmInputs,
    expectedMediaType: 'audio',
  }) : []
  const soundInputs = payload.resource.soundCues.map((cue) => {
    const reference = inputByPosition.get(cue.inputPosition)
    if (!reference || reference.role !== 'sound_effect_audio') {
      throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_SOUND_POSITION_INVALID:${String(cue.inputPosition)}`)
    }
    return reference
  })
  const resolvedSound = soundInputs.length > 0 ? await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: soundInputs,
    expectedMediaType: 'audio',
  }) : []

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-resource-merge-${randomUUID()}-`))
  try {
    await reportTaskProgress(context, 10, { stage: 'workspace_resource_video_merge_prepare' })
    const sourcePaths: string[] = []
    for (const [index, item] of ordered.entries()) {
      const sourcePath = path.join(workspaceDir, `source-${String(index)}.mp4`)
      await writeFile(sourcePath, await getObjectBuffer(item.storageKey))
      sourcePaths.push(sourcePath)
    }
    const dimensions = await probeVideoDimensions(sourcePaths[0] ?? '')
    const durations = await Promise.all(sourcePaths.map(async (sourcePath) => (
      await probeMediaDurationSeconds(sourcePath, 'workspace_resource_video_merge_probe_duration')
    )))
    const audioPaths: string[] = []
    let hasSourceAudio = false
    for (const [index, sourcePath] of sourcePaths.entries()) {
      const durationSeconds = durations[index]
      if (!durationSeconds) throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_DURATION_MISSING:${String(index)}`)
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
        })
        hasSourceAudio = hasSourceAudio || clipHasAudio
        audioPaths.push(audioPath)
      }
    }

    await reportTaskProgress(context, 65, { stage: 'workspace_resource_video_merge_compose' })
    const stitchedPath = await composeVideoMergeVideoTrack({
      sourcePaths,
      durations,
      workspaceDir,
      width: dimensions.width,
      height: dimensions.height,
    })
    const stitchedDurationSeconds = await probeMediaDurationSeconds(
      stitchedPath,
      'workspace_resource_video_merge_probe_duration',
    )
    const mainAudioPath = usesSourceAudio ? path.join(workspaceDir, 'audio.wav') : null
    if (mainAudioPath) {
      await concatVideoMergeAudioClips({
        runCommand: createFfmpegCommandRunner({
          stage: 'workspace_resource_video_merge_concat_audio',
          expectedDurationSeconds: stitchedDurationSeconds,
        }),
        clipAudioPaths: audioPaths,
        outputPath: mainAudioPath,
        durationSeconds: stitchedDurationSeconds,
      })
    }
    const outputPath = path.join(workspaceDir, 'merged.mp4')
    if (hasTimedAudioCues) {
      if (!mainAudioPath) throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_MAIN_AUDIO_REQUIRED')
      const musicCues = await Promise.all(resolvedBgm.map(async (bgm, index) => {
        const placement = payload.resource.musicCues[index]
        if (!placement) throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_BGM_PLACEMENT_MISSING:${String(index)}`)
        const musicPath = path.join(workspaceDir, `bgm-source-${String(index)}`)
        await writeFile(musicPath, await getObjectBuffer(bgm.storageKey))
        return { ...placement, audioPath: musicPath }
      }))
      const soundCues = await Promise.all(resolvedSound.map(async (sound, index) => {
        const placement = payload.resource.soundCues[index]
        if (!placement) throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_SOUND_PLACEMENT_MISSING:${String(index)}`)
        const soundPath = path.join(workspaceDir, `sound-source-${String(index)}`)
        await writeFile(soundPath, await getObjectBuffer(sound.storageKey))
        return { ...placement, audioPath: soundPath }
      }))
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
      const assemblyAudioPath = assemblyAudioStorageKey ? path.join(workspaceDir, 'assembly-audio-source') : null
      if (assemblyAudioPath && assemblyAudioStorageKey) {
        await writeFile(assemblyAudioPath, await getObjectBuffer(assemblyAudioStorageKey))
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

    await reportTaskProgress(context, 92, { stage: 'workspace_resource_video_merge_persist' })
    await assertTaskActive(context, 'persist_workspace_resource_video_merge')
    const outputBuffer = await readFile(outputPath)
    const storageKey = await uploadObject(
      outputBuffer,
      buildTaskArtifactStorageKey({
        taskId: data.taskId,
        artifact: `workspace-resource-video-merge:${payload.resource.resourceId}`,
        extension: 'mp4',
      }),
      'video/mp4',
    )
    const media = await ensureMediaObjectFromStorageKey(storageKey, {
      mimeType: 'video/mp4',
      sizeBytes: outputBuffer.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      durationMs: Math.round(stitchedDurationSeconds * 1000),
    })
    return {
      mediaId: media.id,
      videoUrl: media.url,
      storageKey: media.storageKey,
      durationMs: Math.round(stitchedDurationSeconds * 1000),
      width: dimensions.width,
      height: dimensions.height,
      clipCount: ordered.length,
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
