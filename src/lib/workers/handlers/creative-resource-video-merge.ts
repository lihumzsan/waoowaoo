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
  concatFinalRenderAudioClips,
  muxFinalRenderSourceAudio,
  renderFinalRenderClipAudio,
} from '@/lib/video-compose/final-render-audio'
import { createFfmpegCommandRunner } from '@/lib/video-compose/ffmpeg-command'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  concatClips,
  normalizeClip,
  probeDurationSeconds,
  probeVideoDimensions,
} from '@/lib/workers/final-video-render'
import { assertTaskActive } from '@/lib/workers/utils'

export async function handleCreativeResourceVideoMergeTask(job: Job<TaskJobData>) {
  if (job.data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${job.data.targetType}`)
  }
  const payload = parseCreativeResourceVideoMergeTaskPayload(job.data.payload ?? {})
  if (payload.resource.resourceId !== job.data.targetId) {
    throw new Error(`CREATIVE_RESOURCE_VIDEO_MERGE_TARGET_MISMATCH:${job.data.taskId}`)
  }
  const revisions = await prisma.creativeResourceRevision.findMany({
    where: { id: { in: payload.resource.inputs.map((input) => input.revisionId) } },
    select: {
      id: true,
      resourceId: true,
      fingerprint: true,
      media: { select: { storageKey: true } },
      resource: { select: { userId: true, projectId: true, mediaType: true, status: true } },
    },
  })
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]))
  const ordered = payload.resource.inputs.map((input) => {
    const revision = revisionById.get(input.revisionId)
    if (!revision) throw new Error(`CREATIVE_RESOURCE_INPUT_REVISION_NOT_FOUND:${input.revisionId}`)
    if (
      revision.resourceId !== input.resourceId
      || revision.fingerprint !== input.fingerprint
      || revision.resource.userId !== job.data.userId
      || revision.resource.status !== 'ready'
      || revision.resource.mediaType !== 'video'
      || (revision.resource.projectId && revision.resource.projectId !== job.data.projectId)
      || !revision.media?.storageKey
    ) {
      throw new Error(`CREATIVE_RESOURCE_VIDEO_MERGE_INPUT_CHANGED:${input.revisionId}`)
    }
    return { input, storageKey: revision.media.storageKey }
  })

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
    const durations = await Promise.all(sourcePaths.map(probeDurationSeconds))
    const totalDurationSeconds = durations.reduce((sum, duration) => sum + duration, 0)
    const normalizedPaths: string[] = []
    const audioPaths: string[] = []
    let hasSourceAudio = false
    for (const [index, sourcePath] of sourcePaths.entries()) {
      const durationSeconds = durations[index]
      if (!durationSeconds) throw new Error(`CREATIVE_RESOURCE_VIDEO_MERGE_DURATION_MISSING:${String(index)}`)
      const normalizedPath = path.join(workspaceDir, `normalized-${String(index)}.mp4`)
      const audioPath = path.join(workspaceDir, `audio-${String(index)}.wav`)
      await normalizeClip({
        sourcePath,
        outputPath: normalizedPath,
        durationSeconds,
        width: dimensions.width,
        height: dimensions.height,
      })
      const clipHasAudio = await renderFinalRenderClipAudio({
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
    await concatClips({
      clipPaths: normalizedPaths,
      listPath: path.join(workspaceDir, 'concat.txt'),
      outputPath: stitchedPath,
      durationSeconds: totalDurationSeconds,
    })
    const stitchedDurationSeconds = await probeDurationSeconds(stitchedPath)
    const mainAudioPath = path.join(workspaceDir, 'audio.wav')
    await concatFinalRenderAudioClips({
      runCommand: createFfmpegCommandRunner({
        stage: 'creative_resource_video_merge_concat_audio',
        expectedDurationSeconds: stitchedDurationSeconds,
      }),
      clipAudioPaths: audioPaths,
      outputPath: mainAudioPath,
      durationSeconds: stitchedDurationSeconds,
    })
    const outputPath = path.join(workspaceDir, 'merged.mp4')
    await muxFinalRenderSourceAudio({
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
