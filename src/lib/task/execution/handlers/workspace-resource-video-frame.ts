import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { readStoredImageFacts } from '@/lib/media/stored-image-facts'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import {
  createFfmpegCommandRunner,
  probeMediaDurationSeconds,
} from '@/lib/video-compose/ffmpeg-command'
import { extractLastDecodableVideoFrame } from '@/lib/video-compose/video-frame-extraction'
import { resolveUserUploadAcceptedMedia } from '@/lib/workspace-resource/upload-contract'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { parseWorkspaceResourceVideoFrameTaskPayload } from '@/lib/workspace-resource/video-frame-contract'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive } from '../provider-media'
import { reportTaskProgress } from '../progress'

export async function handleWorkspaceResourceVideoFrameTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceVideoFrameTaskPayload(data.payload ?? {})
  if (payload.resource.resourceId !== data.targetId) {
    throw new Error(`WORKSPACE_RESOURCE_VIDEO_FRAME_TARGET_MISMATCH:${data.taskId}`)
  }
  const [source] = await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: payload.resource.inputs,
    expectedMediaType: 'video',
  })
  if (!source) throw new Error(`WORKSPACE_RESOURCE_VIDEO_FRAME_SOURCE_MISSING:${data.taskId}`)

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-resource-video-frame-${randomUUID()}-`))
  try {
    await reportTaskProgress(context, 15, { stage: 'workspace_resource_prepare' })
    const sourcePath = path.join(workspaceDir, 'source-video')
    const outputPath = path.join(workspaceDir, 'last-frame.png')
    await writeFile(sourcePath, await getObjectBuffer(source.storageKey))
    const expectedDurationSeconds = source.durationMs === null
      ? await probeMediaDurationSeconds(sourcePath, 'workspace_resource_video_frame_probe_duration')
      : source.durationMs / 1000

    await reportTaskProgress(context, 55, { stage: 'workspace_resource_generate' })
    await extractLastDecodableVideoFrame({
      runCommand: createFfmpegCommandRunner({
        stage: 'workspace_resource_video_frame_extract',
        expectedDurationSeconds,
      }),
      sourcePath,
      outputPath,
    })

    const outputBuffer = await readFile(outputPath)
    const metadata = await sharp(outputBuffer).metadata()
    if (
      metadata.format !== 'png'
      || !metadata.width
      || !metadata.height
      || !Number.isSafeInteger(metadata.width)
      || !Number.isSafeInteger(metadata.height)
    ) {
      throw new Error('WORKSPACE_RESOURCE_VIDEO_FRAME_OUTPUT_INVALID')
    }

    await reportTaskProgress(context, 92, { stage: 'workspace_resource_persist' })
    await assertTaskActive(context, 'persist_workspace_resource_video_frame')
    const storageKey = await uploadObject(
      outputBuffer,
      buildTaskArtifactStorageKey({
        taskId: data.taskId,
        artifact: `workspace-resource-video-frame:${payload.resource.resourceId}`,
        extension: 'png',
      }),
      'image/png',
    )
    const storedImage = await readStoredImageFacts(storageKey)
    const accepted = resolveUserUploadAcceptedMedia(storedImage.mimeType)
    if (!accepted || accepted.mediaType !== 'image' || accepted.mimeType !== 'image/png') {
      throw new Error(`WORKSPACE_RESOURCE_VIDEO_FRAME_FORMAT_UNSUPPORTED:${storageKey}`)
    }
    const media = await ensureMediaObjectFromStorageKey(storageKey, {
      sha256: storedImage.sha256,
      mimeType: accepted.mimeType,
      sizeBytes: storedImage.sizeBytes,
      width: metadata.width,
      height: metadata.height,
    })
    return {
      mediaId: media.id,
      imageUrl: media.url,
      storageKey: media.storageKey,
      width: metadata.width,
      height: metadata.height,
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
