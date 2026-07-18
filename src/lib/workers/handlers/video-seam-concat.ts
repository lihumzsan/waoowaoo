import type { Job } from 'bullmq'
import { getProviderConfig } from '@/lib/api-config'
import { runComfyUiVideoSeamConcatWorkflow } from '@/lib/providers/comfyui/client'
import { getSignedObjectUrl, getSignedUrl, uploadObject } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import {
  VIDEO_SEAM_CONCAT_WORKFLOW_KEY,
  buildVideoToolOutputKey,
  isOwnedVideoToolInputKey,
  isValidVideoTrimFrames,
} from '@/lib/video-tools/seam-concat'
import { reportTaskProgress } from '../shared'

type SeamConcatPayload = {
  input1Key: string
  input1Name: string
  input1TrimEndFrames: number
  input2Key: string
  input2Name: string
  input2TrimStartFrames: number
}

function readTrimFrames(value: unknown, defaultValue: number): number {
  const trimFrames = value === undefined ? defaultValue : value
  if (!isValidVideoTrimFrames(trimFrames)) {
    throw new Error('VIDEO_SEAM_CONCAT_PAYLOAD_INVALID')
  }
  return trimFrames
}

function readPayload(job: Job<TaskJobData>): SeamConcatPayload {
  const payload = job.data.payload
  const input1Key = typeof payload?.input1Key === 'string' ? payload.input1Key.trim() : ''
  const input1Name = typeof payload?.input1Name === 'string' ? payload.input1Name.trim() : ''
  const input1TrimEndFrames = readTrimFrames(payload?.input1TrimEndFrames, 0)
  const input2Key = typeof payload?.input2Key === 'string' ? payload.input2Key.trim() : ''
  const input2Name = typeof payload?.input2Name === 'string' ? payload.input2Name.trim() : ''
  const input2TrimStartFrames = readTrimFrames(payload?.input2TrimStartFrames, 1)

  if (!input1Key || !input1Name || !input2Key || !input2Name) {
    throw new Error('VIDEO_SEAM_CONCAT_PAYLOAD_INVALID')
  }
  if (
    !isOwnedVideoToolInputKey(job.data.userId, input1Key)
    || !isOwnedVideoToolInputKey(job.data.userId, input2Key)
  ) {
    throw new Error('VIDEO_SEAM_CONCAT_INPUT_NOT_OWNED')
  }

  return {
    input1Key,
    input1Name,
    input1TrimEndFrames,
    input2Key,
    input2Name,
    input2TrimStartFrames,
  }
}

export async function handleVideoSeamConcatTask(job: Job<TaskJobData>) {
  const payload = readPayload(job)
  const provider = await getProviderConfig(job.data.userId, 'comfyui')
  const baseUrl = provider.baseUrl?.trim()
  if (!baseUrl) {
    throw new Error('COMFYUI_BASE_URL_MISSING')
  }

  await reportTaskProgress(job, 15, {
    stage: 'prepare_inputs',
    stageLabel: 'videoTools.status.preparing',
  })
  const [input1Url, input2Url] = await Promise.all([
    getSignedObjectUrl(payload.input1Key),
    getSignedObjectUrl(payload.input2Key),
  ])

  await reportTaskProgress(job, 35, {
    stage: 'comfyui_processing',
    stageLabel: 'videoTools.status.processing',
  })
  const output = await runComfyUiVideoSeamConcatWorkflow({
    baseUrl,
    workflowKey: VIDEO_SEAM_CONCAT_WORKFLOW_KEY,
    videoUrls: [input1Url, input2Url],
    trimEndFrames: payload.input1TrimEndFrames,
    trimStartFrames: payload.input2TrimStartFrames,
  })

  await reportTaskProgress(job, 90, {
    stage: 'persist_output',
    stageLabel: 'videoTools.status.persisting',
  })
  const outputKey = buildVideoToolOutputKey(job.data.userId)
  const videoKey = await uploadObject(
    Buffer.from(output.videoBase64, 'base64'),
    outputKey,
    undefined,
    output.mimeType || 'video/mp4',
  )

  return {
    videoKey,
    videoUrl: getSignedUrl(videoKey),
    mimeType: output.mimeType || 'video/mp4',
    input1Name: payload.input1Name,
    input1TrimEndFrames: payload.input1TrimEndFrames,
    input2Name: payload.input2Name,
    input2TrimStartFrames: payload.input2TrimStartFrames,
  }
}
