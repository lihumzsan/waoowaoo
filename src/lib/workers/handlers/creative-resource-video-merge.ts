import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Job } from 'bullmq'
import { parseCreativeResourceVideoMergeTaskPayload } from '@/lib/creative-resource/video-merge-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import type { TaskJobData } from '@/lib/task/types'
import {
  concatVideoMergeAudioClips,
  muxVideoMergeAudio,
  muxVideoMergeSourceAudio,
  renderVideoMergeClipAudio,
} from '@/lib/video-compose/video-merge-audio'
import { createFfmpegCommandRunner } from '@/lib/video-compose/ffmpeg-command'
import {
  concatVideoClips,
  normalizeVideoClip,
  probeMediaDurationSeconds,
  probeVideoDimensions,
} from '@/lib/video-compose/video-merge-ffmpeg'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

export async function handleCreativeResourceVideoMergeTask(job: Job<TaskJobData>) {
  if (job.data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${job.data.targetType}`)
  }
  const payload = parseCreativeResourceVideoMergeTaskPayload(job.data.payload ?? {})
  if (payload.resource.resourceId !== job.data.targetId) {
    throw new Error(`CREATIVE_RESOURCE_VIDEO_MERGE_TARGET_MISMATCH:${job.data.taskId}`)
  }
  const resources = await prisma.creativeResource.findMany({
    where: { id: { in: payload.resource.inputs.map((input) => input.resourceId) } },
    select: {
      id: true,
      media: { select: { storageKey: true } },
      userId: true,
      projectId: true,
      mediaType: true,
      status: true,
    },
  })
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const resolveInputStorageKey = (input: (typeof payload.resource.inputs)[number]): string => {
    const resource = resourceById.get(input.resourceId)
    if (!resource) throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_FOUND:${input.resourceId}`)
    const expectedMediaType = input.role === 'bgm_audio' ? 'audio' : 'video'
    if (
      resource.userId !== job.data.userId
      || resource.status !== 'ready'
      || resource.mediaType !== expectedMediaType
      || (resource.projectId && resource.projectId !== job.data.projectId)
      || !resource.media?.storageKey
    ) {
      throw new Error(`CREATIVE_RESOURCE_VIDEO_MERGE_INPUT_CHANGED:${input.resourceId}`)
    }
    return resource.media.storageKey
  }
  const ordered = payload.resource.inputs
    .filter((input) => input.role === 'source_video')
    .map((input) => ({ input, storageKey: resolveInputStorageKey(input) }))
  const bgmInput = payload.resource.inputs.find((input) => input.role === 'bgm_audio') ?? null
  const bgmStorageKey = bgmInput ? resolveInputStorageKey(bgmInput) : null
  const rawBgmVolume = payload.resource.generationOptions['bgmVolume']
  const bgmVolume = bgmInput
    ? (typeof rawBgmVolume === 'number' && Number.isFinite(rawBgmVolume) && rawBgmVolume > 0 && rawBgmVolume <= 4
        ? rawBgmVolume
        : null)
    : null
  if (bgmInput && bgmVolume === null) {
    throw new Error(`CREATIVE_RESOURCE_VIDEO_MERGE_BGM_VOLUME_INVALID:${job.data.taskId}`)
  }

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-resource-merge-${randomUUID()}-`))
  try {
    await reportTaskProgress(job, 10, { stage: 'creative_resource_video_merge_prepare' })
    const sourcePaths: string[] = []
    for (const [index, item] of ordered.entries()) {
      const sourcePath = path.join(workspaceDir, `source-${String(index)}.mp4`)
      await writeFile(sourcePath, await getObjectBuffer(item.storageKey))
      sourcePaths.push(sourcePath)
    }
    const dimensions = await probeVideoDimensions(sourcePaths[0] ?? '')
    const durations = await Promise.all(sourcePaths.map(probeMediaDurationSeconds))
    const totalDurationSeconds = durations.reduce((sum, duration) => sum + duration, 0)
    const normalizedPaths: string[] = []
    const audioPaths: string[] = []
    let hasSourceAudio = false
    for (const [index, sourcePath] of sourcePaths.entries()) {
      const durationSeconds = durations[index]
      if (!durationSeconds) throw new Error(`CREATIVE_RESOURCE_VIDEO_MERGE_DURATION_MISSING:${String(index)}`)
      const normalizedPath = path.join(workspaceDir, `normalized-${String(index)}.mp4`)
      const audioPath = path.join(workspaceDir, `audio-${String(index)}.wav`)
      await normalizeVideoClip({
        sourcePath,
        outputPath: normalizedPath,
        durationSeconds,
        width: dimensions.width,
        height: dimensions.height,
      })
      const clipHasAudio = await renderVideoMergeClipAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'creative_resource_video_merge_clip_audio',
          expectedDurationSeconds: durationSeconds,
        }),
        sourcePath,
        outputPath: audioPath,
        durationSeconds,
      })
      hasSourceAudio = hasSourceAudio || clipHasAudio
      normalizedPaths.push(normalizedPath)
      audioPaths.push(audioPath)
    }

    await reportTaskProgress(job, 65, { stage: 'creative_resource_video_merge_compose' })
    const stitchedPath = path.join(workspaceDir, 'stitched.mp4')
    await concatVideoClips({
      clipPaths: normalizedPaths,
      listPath: path.join(workspaceDir, 'concat.txt'),
      outputPath: stitchedPath,
      durationSeconds: totalDurationSeconds,
    })
    const stitchedDurationSeconds = await probeMediaDurationSeconds(stitchedPath)
    const mainAudioPath = path.join(workspaceDir, 'audio.wav')
    await concatVideoMergeAudioClips({
      runCommand: createFfmpegCommandRunner({
        stage: 'creative_resource_video_merge_concat_audio',
        expectedDurationSeconds: stitchedDurationSeconds,
      }),
      clipAudioPaths: audioPaths,
      outputPath: mainAudioPath,
      durationSeconds: stitchedDurationSeconds,
    })
    const outputPath = path.join(workspaceDir, 'merged.mp4')
    if (bgmStorageKey && bgmVolume !== null) {
      const bgmPath = path.join(workspaceDir, 'bgm-source')
      await writeFile(bgmPath, await getObjectBuffer(bgmStorageKey))
      await muxVideoMergeAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'creative_resource_video_merge_mux',
          expectedDurationSeconds: stitchedDurationSeconds,
        }),
        stitchedPath,
        mainAudioPath,
        hasSourceAudio,
        musicPath: bgmPath,
        outputPath,
        durationSeconds: stitchedDurationSeconds,
        volume: bgmVolume,
      })
    } else {
      await muxVideoMergeSourceAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'creative_resource_video_merge_mux',
          expectedDurationSeconds: stitchedDurationSeconds,
        }),
        stitchedPath,
        mainAudioPath,
        hasSourceAudio,
        outputPath,
        durationSeconds: stitchedDurationSeconds,
      })
    }

    await reportTaskProgress(job, 92, { stage: 'creative_resource_video_merge_persist' })
    await assertTaskActive(job, 'persist_creative_resource_video_merge')
    const outputBuffer = await readFile(outputPath)
    const storageKey = await uploadObject(
      outputBuffer,
      buildTaskArtifactStorageKey({
        taskId: job.data.taskId,
        artifact: `creative-resource-video-merge:${payload.resource.resourceId}`,
        extension: 'mp4',
      }),
      1,
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
