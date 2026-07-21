import type { Job } from 'bullmq'
import { getProviderConfig } from '@/lib/api-config'
import {
  runComfyUiVideoSeamBridgeComposeWorkflow,
  runComfyUiVideoSeamConcatWorkflow,
  runComfyUiVideoSeamEndpointWorkflow,
  runComfyUiVideoWorkflow,
} from '@/lib/providers/comfyui/client'
import { COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID } from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { getSignedObjectUrl, getSignedUrl, uploadObjectStream } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import {
  VIDEO_SEAM_CONCAT_WORKFLOW_KEY,
  buildVideoToolOutputKey,
  isOwnedVideoToolInputKey,
  isValidVideoTrimFrames,
} from '@/lib/video-tools/seam-concat'
import { parseVideoSeamBridgeOptions, type VideoSeamBridgeOptions } from '@/lib/video-tools/seam-bridge'
import { reportTaskProgress } from '../shared'

type SeamConcatPayload = {
  input1Key: string
  input1Name: string
  input1TrimEndFrames: number
  input2Key: string
  input2Name: string
  input2TrimStartFrames: number
  mode: 'direct' | 'ai_bridge'
  bridge?: VideoSeamBridgeOptions
}

const DEFAULT_AI_BRIDGE_PROMPT = 'Continuous natural camera motion and subject movement between the exact first and last frame. Preserve subject identity, setting, lighting, lens, and direction of motion. No cut, no dissolve, no fade, no overlay.'

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
  const mode = payload?.mode === undefined ? 'direct' : payload.mode
  if (mode !== 'direct' && mode !== 'ai_bridge') {
    throw new Error('VIDEO_SEAM_CONCAT_PAYLOAD_INVALID')
  }
  const bridge = mode === 'ai_bridge' ? parseVideoSeamBridgeOptions(payload?.bridge) : undefined

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
    mode,
    ...(bridge ? { bridge } : {}),
  }
}

function asImageDataUrl(imageBase64: string, mimeType: string): string {
  const safeMimeType = mimeType.startsWith('image/') ? mimeType : 'image/png'
  return `data:${safeMimeType};base64,${imageBase64}`
}

function resolveOutputContentLength(response: Response, expectedLength: number | undefined): number {
  const rawLength = response.headers.get('content-length')?.trim()
  let contentLength = expectedLength
  if (rawLength) {
    if (!/^\d+$/.test(rawLength)) {
      throw new Error('COMFYUI_VIEW_CONTENT_LENGTH_INVALID')
    }
    contentLength = Number(rawLength)
  }
  if (!Number.isSafeInteger(contentLength) || (contentLength as number) <= 0) {
    throw new Error('COMFYUI_VIEW_CONTENT_LENGTH_MISSING')
  }
  if (expectedLength !== undefined && contentLength !== expectedLength) {
    throw new Error('COMFYUI_VIEW_CONTENT_LENGTH_MISMATCH')
  }
  return contentLength as number
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
  const output = payload.mode === 'ai_bridge'
    ? await buildAiBridgeOutput({ baseUrl, input1Url, input2Url, payload })
    : await runComfyUiVideoSeamConcatWorkflow({
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
  const response = await fetch(output.videoUrl, {
    signal: AbortSignal.timeout(120_000),
  })
  const responseBody = response.body
  let mimeType: string
  let videoKey: string
  try {
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`COMFYUI_VIEW_FAILED: ${response.status} ${detail.slice(0, 200)}`)
    }
    if (!responseBody) {
      throw new Error('COMFYUI_VIEW_BODY_MISSING')
    }

    const contentLength = resolveOutputContentLength(response, output.contentLength)
    const responseMimeType = response.headers.get('content-type')?.split(';')[0]?.trim()
    mimeType = responseMimeType && responseMimeType !== 'application/octet-stream'
      ? responseMimeType
      : output.mimeType || 'video/mp4'
    const outputKey = buildVideoToolOutputKey(job.data.userId)
    videoKey = await uploadObjectStream(
      responseBody,
      outputKey,
      contentLength,
      mimeType,
    )
  } catch (error) {
    await responseBody?.cancel().catch(() => undefined)
    throw error
  }

  return {
    videoKey,
    videoUrl: getSignedUrl(videoKey),
    mimeType,
    input1Name: payload.input1Name,
    input1TrimEndFrames: payload.input1TrimEndFrames,
    input2Name: payload.input2Name,
    input2TrimStartFrames: payload.input2TrimStartFrames,
  }
}

async function buildAiBridgeOutput({
  baseUrl,
  input1Url,
  input2Url,
  payload,
}: {
  baseUrl: string
  input1Url: string
  input2Url: string
  payload: SeamConcatPayload
}) {
  if (!payload.bridge) throw new Error('VIDEO_SEAM_BRIDGE_REQUIRED')

  const [beforeEndpoint, afterEndpoint] = await Promise.all([
    runComfyUiVideoSeamEndpointWorkflow({
      baseUrl,
      videoUrl: input1Url,
      position: 'end',
      trimFrames: payload.input1TrimEndFrames,
    }),
    runComfyUiVideoSeamEndpointWorkflow({
      baseUrl,
      videoUrl: input2Url,
      position: 'start',
      trimFrames: payload.input2TrimStartFrames,
    }),
  ])

  const bridge = await runComfyUiVideoWorkflow({
    baseUrl,
    workflowKey: COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID,
    prompt: payload.bridge.prompt || DEFAULT_AI_BRIDGE_PROMPT,
    firstFrameImageUrl: asImageDataUrl(beforeEndpoint.imageBase64, beforeEndpoint.mimeType),
    lastFrameImageUrl: asImageDataUrl(afterEndpoint.imageBase64, afterEndpoint.mimeType),
    durationSeconds: payload.bridge.durationSeconds,
    fps: 24,
  })

  return await runComfyUiVideoSeamBridgeComposeWorkflow({
    baseUrl,
    videoUrls: [input1Url, bridge.videoUrl, input2Url],
    trimEndFrames: payload.input1TrimEndFrames,
    trimStartFrames: payload.input2TrimStartFrames,
  })
}
