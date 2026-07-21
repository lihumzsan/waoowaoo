import type { Job } from 'bullmq'
import { getProviderConfig } from '@/lib/api-config'
import {
  runComfyUiVideoSeamConcatWorkflow,
  runComfyUiVideoSeamMotionBridgeWorkflow,
} from '@/lib/providers/comfyui/client'
import { getSignedObjectUrl, getSignedUrl, uploadObjectStream } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { buildVideoSeamBridgePlan, type VideoSeamBridgePlan } from '@/lib/video-tools/seam-bridge-plan'
import {
  VIDEO_SEAM_CONCAT_WORKFLOW_KEY,
  buildVideoToolOutputKey,
  isOwnedVideoToolInputKey,
  isValidVideoTrimFrames,
} from '@/lib/video-tools/seam-concat'
import {
  DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT,
  parseVideoSeamBridgeOptions,
  type VideoSeamBridgeOptions,
} from '@/lib/video-tools/seam-bridge'
import {
  composeVideoSeamOutput,
  createVideoSeamWorkspace,
  downloadVideoSeamFile,
  extractVideoSeamAnchors,
  openVideoSeamOutput,
  probeVideoSeamFile,
  readVideoSeamAnchorDataUrl,
  verifyVideoSeamOutput,
  type VideoSeamWorkspace,
} from '@/lib/video/video-seam-media'
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

type RemoteVideoOutput = {
  videoUrl: string
  mimeType: string
  contentLength?: number
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

async function persistRemoteOutput({
  job,
  payload,
  output,
}: {
  job: Job<TaskJobData>
  payload: SeamConcatPayload
  output: RemoteVideoOutput
}) {
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
    mode: 'direct' as const,
    input1Name: payload.input1Name,
    input1TrimEndFrames: payload.input1TrimEndFrames,
    input2Name: payload.input2Name,
    input2TrimStartFrames: payload.input2TrimStartFrames,
  }
}

async function persistLocalAiOutput({
  job,
  workspace,
  payload,
  plan,
  probe1,
  probe2,
  output,
}: {
  job: Job<TaskJobData>
  workspace: VideoSeamWorkspace
  payload: SeamConcatPayload
  plan: VideoSeamBridgePlan
  probe1: VideoSeamBridgePlan['input1']
  probe2: VideoSeamBridgePlan['input2']
  output: VideoSeamBridgePlan['input1']
}) {
  const localOutput = await openVideoSeamOutput(workspace.outputPath)
  let videoKey: string
  try {
    videoKey = await uploadObjectStream(
      localOutput.body,
      buildVideoToolOutputKey(job.data.userId),
      localOutput.contentLength,
      localOutput.mimeType,
    )
  } catch (error) {
    await localOutput.body.cancel().catch(() => undefined)
    throw error
  }
  return {
    videoKey,
    videoUrl: getSignedUrl(videoKey),
    mimeType: localOutput.mimeType,
    mode: 'ai_bridge' as const,
    input1Name: payload.input1Name,
    input1TrimEndFrames: payload.input1TrimEndFrames,
    input2Name: payload.input2Name,
    input2TrimStartFrames: payload.input2TrimStartFrames,
    probes: { input1: probe1, input2: probe2 },
    output,
    bridge: {
      requestedDurationSeconds: plan.requestedDurationSeconds,
      handleFrames: plan.handleFrames,
      generatedFrameCount: plan.generatedFrameCount,
      generationCanvas: plan.generationCanvas,
      sourceAnchors: plan.sourceAnchors,
      generatedAnchors: plan.generatedAnchors,
      centralFrameCount: plan.centralFrameCount,
      centralSilenceSeconds: plan.centralSilenceSeconds,
      video2AudioTempoFactor: plan.video2AudioTempoFactor,
      audioPolicy: plan.audioPolicy,
      targetBitrateMbps: plan.targetBitrateMbps,
    },
  }
}

async function settleConcurrentWork<T>(operations: Array<Promise<T>>): Promise<T[]> {
  let primaryError: unknown
  let failed = false
  const trackedOperations = operations.map((operation) => operation.catch((error) => {
    if (!failed) {
      failed = true
      primaryError = error
    }
    throw error
  }))
  const results = await Promise.allSettled(trackedOperations)
  if (failed) throw primaryError
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
}

async function buildAiBridgeResult({
  job,
  baseUrl,
  input1Url,
  input2Url,
  payload,
}: {
  job: Job<TaskJobData>
  baseUrl: string
  input1Url: string
  input2Url: string
  payload: SeamConcatPayload
}) {
  if (!payload.bridge) throw new Error('VIDEO_SEAM_BRIDGE_REQUIRED')

  const workspace = await createVideoSeamWorkspace()
  try {
    await reportTaskProgress(job, 20, {
      stage: 'probe_media',
      stageLabel: 'videoTools.status.probing',
    })
    const inputDownloadController = new AbortController()
    const inputDownloads = [
      downloadVideoSeamFile(input1Url, workspace.input1Path, {
        signal: inputDownloadController.signal,
      }),
      downloadVideoSeamFile(input2Url, workspace.input2Path, {
        signal: inputDownloadController.signal,
      }),
    ]
    try {
      await Promise.all(inputDownloads)
    } catch (error) {
      inputDownloadController.abort(error)
      await Promise.allSettled(inputDownloads)
      throw error
    }
    const [probe1, probe2] = await settleConcurrentWork([
      probeVideoSeamFile(workspace.input1Path),
      probeVideoSeamFile(workspace.input2Path),
    ])
    const plan = buildVideoSeamBridgePlan({
      input1: probe1,
      input2: probe2,
      trimEndFrames: payload.input1TrimEndFrames,
      trimStartFrames: payload.input2TrimStartFrames,
      durationSeconds: payload.bridge.durationSeconds,
    })

    await reportTaskProgress(job, 35, {
      stage: 'extract_anchors',
      stageLabel: 'videoTools.status.probing',
    })
    await settleConcurrentWork([
      extractVideoSeamAnchors({
        inputPath: workspace.input1Path,
        indices: [plan.sourceAnchors.input1Pre, plan.sourceAnchors.input1Endpoint],
        rawOutputPaths: workspace.input1AnchorPaths,
        normalizedOutputPaths: [workspace.normalizedAnchorPaths[0], workspace.normalizedAnchorPaths[1]],
        displayRotationDegrees: probe1.displayRotationDegrees || 0,
        plan,
      }),
      extractVideoSeamAnchors({
        inputPath: workspace.input2Path,
        indices: [plan.sourceAnchors.input2Endpoint, plan.sourceAnchors.input2Post],
        rawOutputPaths: workspace.input2AnchorPaths,
        normalizedOutputPaths: [workspace.normalizedAnchorPaths[2], workspace.normalizedAnchorPaths[3]],
        displayRotationDegrees: probe2.displayRotationDegrees || 0,
        plan,
      }),
    ])
    const anchorValues = await Promise.all(
      workspace.normalizedAnchorPaths.map(readVideoSeamAnchorDataUrl),
    )
    const anchors = anchorValues as [string, string, string, string]

    await reportTaskProgress(job, 45, {
      stage: 'generate_bridge',
      stageLabel: 'videoTools.status.generating',
    })
    const generated = await runComfyUiVideoSeamMotionBridgeWorkflow({
      baseUrl,
      prompt: payload.bridge.prompt || DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT,
      anchorImageUrls: anchors,
      generatedAnchorIndices: plan.generatedAnchors,
      width: plan.generationCanvas.width,
      height: plan.generationCanvas.height,
      fps: plan.outputFps,
      durationSeconds: plan.requestedDurationSeconds,
    })
    await downloadVideoSeamFile(generated.videoUrl, workspace.bridgePath)
    const bridgeProbe = await probeVideoSeamFile(workspace.bridgePath)
    const bridgeFpsDelta = Math.abs(bridgeProbe.fps - plan.outputFps) / plan.outputFps
    if (
      bridgeProbe.frameCount !== plan.generatedFrameCount
      || bridgeProbe.width !== plan.generationCanvas.width
      || bridgeProbe.height !== plan.generationCanvas.height
      || bridgeFpsDelta > 0.002
    ) {
      throw new Error('VIDEO_SEAM_GENERATED_RANGE_INVALID')
    }

    await reportTaskProgress(job, 75, {
      stage: 'compose_output',
      stageLabel: 'videoTools.status.composing',
    })
    await composeVideoSeamOutput({
      input1Path: workspace.input1Path,
      bridgePath: workspace.bridgePath,
      input2Path: workspace.input2Path,
      outputPath: workspace.outputPath,
      plan,
    })
    const output = await verifyVideoSeamOutput(workspace.outputPath, plan)
    await reportTaskProgress(job, 90, {
      stage: 'persist_output',
      stageLabel: 'videoTools.status.persisting',
    })
    return await persistLocalAiOutput({
      job,
      workspace,
      payload,
      plan,
      probe1,
      probe2,
      output,
    })
  } finally {
    await workspace.cleanup().catch(() => undefined)
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

  if (payload.mode === 'ai_bridge') {
    return await buildAiBridgeResult({ job, baseUrl, input1Url, input2Url, payload })
  }

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
  return await persistRemoteOutput({ job, payload, output })
}
