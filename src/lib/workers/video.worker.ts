import { Worker, type Job } from 'bullmq'
import { requireVideoModelMaxReferenceImages } from '@/lib/ai-registry/video-model-helpers'
import { normalizeOwnedMediaToBase64ForGeneration } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { getTaskDefinitionForQueue, type VideoTaskHandlerKey } from '@/lib/task/definition'
import { QUEUE_NAME } from '@/lib/task/queues'
import type { TaskJobData } from '@/lib/task/types'
import { videoSegmentTaskPayloadSchema } from '@/lib/video-segments/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { handleChapterRenderTask } from './chapter-render'
import { handleFinalVideoRenderTask } from './final-video-render'
import { getWorkerConcurrency } from './runtime-config'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import {
  assertTaskActive,
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToCos,
} from './utils'
import { resolveVideoDownloadHeaders } from './video-download'
import { handleCreativeResourceVideoTask } from './handlers/creative-resource-video'
import { handleCreativeResourceVideoMergeTask } from './handlers/creative-resource-video-merge'

async function handleVideoSegmentTask(job: Job<TaskJobData>) {
  if (job.data.targetType !== 'ProjectVideoSegment') {
    throw new Error(`VIDEO_SEGMENT_TARGET_INVALID:${job.data.targetType}`)
  }
  const payload = videoSegmentTaskPayloadSchema.parse(job.data.payload ?? {})
  const segmentId = job.data.targetId
  const current = await prisma.projectVideoSegment.findFirst({
    where: {
      id: segmentId,
      projectId: job.data.projectId,
      episodeId: payload.episodeId,
      chapterId: payload.chapterId,
      editScriptId: payload.editScriptId,
      segmentId: payload.segmentId,
      project: { userId: job.data.userId },
      inputSignature: payload.inputSignature,
      generationTaskId: job.data.taskId,
    },
    select: {
      status: true,
      videoMediaId: true,
      videoMedia: { select: { storageKey: true } },
    },
  })
  if (!current) throw new Error(`VIDEO_SEGMENT_TASK_OWNERSHIP_STALE:${segmentId}:${job.data.taskId}`)
  if (current.status === 'completed') {
    if (!current.videoMediaId || !current.videoMedia) {
      throw new Error(`VIDEO_SEGMENT_COMPLETED_MEDIA_MISSING:${segmentId}`)
    }
    return {
      videoSegmentId: segmentId,
      segmentId: payload.segmentId,
      videoMediaId: current.videoMediaId,
      videoStorageKey: current.videoMedia.storageKey,
      durationSec: payload.durationSec,
    }
  }

  const maxReferenceImages = requireVideoModelMaxReferenceImages(payload.videoModel)
  if (payload.referenceImages.length > maxReferenceImages) {
    throw new Error(`VIDEO_SEGMENT_REFERENCE_IMAGE_LIMIT_EXCEEDED:${payload.segmentId}:${String(payload.referenceImages.length)}:${String(maxReferenceImages)}`)
  }
  if (
    payload.generationOptions.generateAudio !== true
    || payload.generationOptions.generationMode !== 'normal'
    || payload.generationOptions.duration !== payload.durationSec
  ) {
    throw new Error(`VIDEO_SEGMENT_GENERATION_OPTIONS_INVALID:${payload.segmentId}`)
  }
  const sourceMedia = await prisma.mediaObject.findMany({
    where: { id: { in: payload.referenceImages.map((reference) => reference.mediaId) } },
    select: { id: true, storageKey: true },
  })
  const storageKeyByMediaId = new Map(sourceMedia.map((media) => [media.id, media.storageKey]))
  for (const reference of payload.referenceImages) {
    if (storageKeyByMediaId.get(reference.mediaId) !== reference.source) {
      throw new Error(`VIDEO_SEGMENT_REFERENCE_MEDIA_CHANGED:${payload.segmentId}:${reference.mediaId}`)
    }
  }

  const started = await prisma.projectVideoSegment.updateMany({
    where: {
      id: segmentId,
      inputSignature: payload.inputSignature,
      generationTaskId: job.data.taskId,
      status: { in: ['queued', 'pending', 'processing', 'generating'] },
    },
    data: {
      status: 'processing',
      errorCode: null,
      errorMessage: null,
    },
  })
  if (started.count !== 1) throw new Error(`VIDEO_SEGMENT_TASK_OWNERSHIP_STALE:${segmentId}:${job.data.taskId}`)

  await reportTaskProgress(job, 18, { stage: 'video_segment_references', videoSegmentId: segmentId })
  const referenceImages = await Promise.all(payload.referenceImages.map(async (reference) => ({
    url: await normalizeOwnedMediaToBase64ForGeneration(reference.source, job.data.userId),
    role: 'reference' as const,
    order: reference.order,
    source: 'asset' as const,
  })))

  await reportTaskProgress(job, 40, { stage: 'video_segment_generate', videoSegmentId: segmentId })
  const generated = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: payload.videoModel,
    referenceImages,
    options: {
      ...payload.generationOptions,
      prompt: payload.prompt,
      aspectRatio: payload.aspectRatio,
      duration: payload.durationSec,
      generationMode: 'normal',
      generateAudio: true,
    },
  })
  const downloadHeaders = await resolveVideoDownloadHeaders(
    job.data.userId,
    payload.videoModel,
    generated.url,
    generated.downloadHeaders,
  )

  await reportTaskProgress(job, 92, { stage: 'video_segment_persist', videoSegmentId: segmentId })
  const storageKey = await uploadVideoSourceToCos(
    generated.url,
    'video-segment',
    segmentId,
    downloadHeaders,
    { taskId: job.data.taskId, artifact: `video-segment:${segmentId}:${payload.inputSignature}` },
  )
  const videoMedia = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: 'video/mp4',
    durationMs: payload.durationSec * 1000,
  })
  await assertTaskActive(job, 'persist_video_segment')
  const completed = await prisma.projectVideoSegment.updateMany({
    where: {
      id: segmentId,
      inputSignature: payload.inputSignature,
      generationTaskId: job.data.taskId,
      status: 'processing',
    },
    data: {
      status: 'completed',
      videoMediaId: videoMedia.id,
      errorCode: null,
      errorMessage: null,
    },
  })
  if (completed.count !== 1) throw new Error(`VIDEO_SEGMENT_TASK_OWNERSHIP_STALE:${segmentId}:${job.data.taskId}`)
  return {
    videoSegmentId: segmentId,
    segmentId: payload.segmentId,
    videoMediaId: videoMedia.id,
    videoStorageKey: videoMedia.storageKey,
    durationSec: payload.durationSec,
    ...(typeof generated.actualVideoTokens === 'number'
      ? { actualVideoTokens: generated.actualVideoTokens }
      : {}),
  }
}

type VideoTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const VIDEO_TASK_HANDLERS = {
  creative_resource_video: handleCreativeResourceVideoTask,
  creative_resource_video_merge: handleCreativeResourceVideoMergeTask,
  video_segment: handleVideoSegmentTask,
  final_video_render: handleFinalVideoRenderTask,
  chapter_render: handleChapterRenderTask,
} satisfies Record<VideoTaskHandlerKey, VideoTaskHandler>

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })
  const definition = getTaskDefinitionForQueue(job.data.type, 'video')
  return await VIDEO_TASK_HANDLERS[definition.workerHandler](job)
}

export function createVideoWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VIDEO,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'video',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.video,
        run: async () => await processVideoTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: getWorkerConcurrency('video'),
    },
  )
}
