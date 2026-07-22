import type { Job } from 'bullmq'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getProviderConfig } from '@/lib/api-config'
import { executeAiTextStep, executeAiVisionStep } from '@/lib/ai-runtime'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { runComfyUiAudioWorkflow } from '@/lib/providers/comfyui/client'
import { deleteObject, getSignedObjectUrl, getSignedUrl, uploadObject } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import {
  STABLE_AUDIO_3_MEDIUM_WORKFLOW_KEY,
  applyEnvironmentSoundPromptSync,
  assertEnvironmentSoundVideoDuration,
  buildEnvironmentSoundOutputKey,
  buildEnvironmentSoundPieces,
  isOwnedEnvironmentSoundTemporaryObjectKey,
  parseEnvironmentSoundPlan,
  parseEnvironmentSoundSubmission,
  type EnvironmentSoundAnalyzeSubmission,
  type EnvironmentSoundGenerateSubmission,
} from '@/lib/video-tools/environment-sound'
import { scheduleEnvironmentSoundCleanup } from '@/lib/video-tools/environment-sound-cleanup'
import {
  composeEnvironmentSoundMp3,
  detectEnvironmentSoundAudioActivity,
  detectEnvironmentSoundSceneChanges,
  downloadEnvironmentSoundSource,
  extractEnvironmentSoundFrames,
  measureEnvironmentSoundAudioLevel,
  probeEnvironmentSoundMedia,
  summarizeEnvironmentSoundSourceAudioActivity,
  summarizeEnvironmentSoundVoiceActivity,
} from '@/lib/video-tools/environment-sound-media'
import { safeParseJsonObject } from '@/lib/json-repair'
import { reportTaskProgress } from '../shared'
import { resolveAnalysisModel } from './resolve-analysis-model'

const DURATION_TOLERANCE_SECONDS = 0.1

function sourceExtension(name: string, fallback: string): string {
  const extension = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '')
  return extension || fallback
}

function readAnalyzeSubmission(job: Job<TaskJobData>): EnvironmentSoundAnalyzeSubmission {
  const submission = parseEnvironmentSoundSubmission(job.data.userId, job.data.payload)
  if (submission.action !== 'analyze') throw new Error('ENVIRONMENT_SOUND_ANALYZE_PAYLOAD_INVALID')
  return submission
}

function readGenerateSubmission(job: Job<TaskJobData>): EnvironmentSoundGenerateSubmission {
  const submission = parseEnvironmentSoundSubmission(job.data.userId, job.data.payload)
  if (submission.action !== 'generate') throw new Error('ENVIRONMENT_SOUND_GENERATE_PAYLOAD_INVALID')
  return submission
}

async function frameDataUrls(frames: Array<{ filePath: string }>): Promise<string[]> {
  return await Promise.all(frames.map(async (frame) => {
    const buffer = await fs.readFile(frame.filePath)
    return `data:image/jpeg;base64,${buffer.toString('base64')}`
  }))
}

function assertDurationMatches(actual: number, expected: number, code: string): void {
  if (Math.abs(actual - expected) > DURATION_TOLERANCE_SECONDS) throw new Error(code)
}

function promptSyncInput(plan: ReturnType<typeof parseEnvironmentSoundPlan>) {
  return {
    durationSeconds: plan.durationSeconds,
    summaryZh: plan.summaryZh,
    zones: plan.zones.map((zone) => ({
      id: zone.id,
      startSeconds: zone.startSeconds,
      endSeconds: zone.endSeconds,
      sceneZh: zone.sceneZh,
      ambienceZh: zone.ambienceZh,
      eventSoundsZh: zone.eventSoundsZh,
      avoidSoundsZh: zone.avoidSoundsZh,
      transitionToNext: zone.transitionToNext,
      currentPromptEn: zone.promptEn,
      currentNegativePromptEn: zone.negativePromptEn,
    })),
  }
}

async function synchronizeEnvironmentSoundPrompts(
  job: Job<TaskJobData>,
  plan: ReturnType<typeof parseEnvironmentSoundPlan>,
) {
  const analysisModel = await resolveAnalysisModel({ userId: job.data.userId })
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.VIDEO_TOOLS_ENVIRONMENT_SOUND_PROMPT_SYNC,
    locale: job.data.locale,
    variables: { edited_plan: JSON.stringify(promptSyncInput(plan)) },
  })
  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model: analysisModel,
    messages: [{ role: 'user', content: prompt }],
    projectId: job.data.projectId,
    action: 'environment_sound_prompt_sync',
    meta: {
      stepId: 'environment_sound_prompt_sync',
      stepTitle: 'Environment sound prompt synchronization',
      stepIndex: 1,
      stepTotal: 1,
    },
    temperature: 0.1,
  })
  return applyEnvironmentSoundPromptSync(plan, safeParseJsonObject(completion.text))
}

export async function handleEnvironmentSoundAnalyzeTask(job: Job<TaskJobData>) {
  const payload = readAnalyzeSubmission(job)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waoo-environment-analyze-'))
  const videoPath = path.join(tempDir, `source${sourceExtension(payload.videoName, '.mp4')}`)

  try {
    await reportTaskProgress(job, 12, { stage: 'environment_sound_prepare' })
    await downloadEnvironmentSoundSource(await getSignedObjectUrl(payload.videoKey), videoPath)
    const videoProbe = await probeEnvironmentSoundMedia(videoPath)
    assertEnvironmentSoundVideoDuration(videoProbe.durationSeconds)

    let sourceAudioActivity: Array<{ startSeconds: number; endSeconds: number }> = []
    let sourceAudioAnalysis: ReturnType<typeof summarizeEnvironmentSoundSourceAudioActivity> | null = null
    if (videoProbe.hasAudio) {
      sourceAudioActivity = await detectEnvironmentSoundAudioActivity(videoPath, videoProbe.durationSeconds)
      sourceAudioAnalysis = summarizeEnvironmentSoundSourceAudioActivity(
        sourceAudioActivity,
        videoProbe.durationSeconds,
      )
    }
    const sceneChangeTimes = await detectEnvironmentSoundSceneChanges(videoPath)
    const frames = await extractEnvironmentSoundFrames(
      videoPath,
      path.join(tempDir, 'frames'),
      videoProbe.durationSeconds,
      sceneChangeTimes,
    )

    let voiceActivity: Array<{ startSeconds: number; endSeconds: number }> = []
    let voiceAnalysis: ReturnType<typeof summarizeEnvironmentSoundVoiceActivity> | null = null
    if (payload.voiceKey) {
      const voicePath = path.join(tempDir, `voice${sourceExtension(payload.voiceKey, '.mp3')}`)
      await downloadEnvironmentSoundSource(await getSignedObjectUrl(payload.voiceKey), voicePath)
      const voiceProbe = await probeEnvironmentSoundMedia(voicePath)
      voiceActivity = await detectEnvironmentSoundAudioActivity(voicePath, voiceProbe.durationSeconds)
      voiceAnalysis = summarizeEnvironmentSoundVoiceActivity(
        voiceActivity,
        voiceProbe.durationSeconds,
        videoProbe.durationSeconds,
      )
    }

    await reportTaskProgress(job, 55, { stage: 'environment_sound_analyze' })
    const analysisModel = await resolveAnalysisModel({ userId: job.data.userId })
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.VIDEO_TOOLS_ENVIRONMENT_SOUND_ANALYSIS,
      locale: job.data.locale,
      variables: {
        video_duration: videoProbe.durationSeconds.toFixed(3),
        frame_timestamps: JSON.stringify(frames.map((frame) => frame.timestampSeconds)),
        has_source_audio: String(videoProbe.hasAudio),
        source_audio_activity: JSON.stringify(sourceAudioAnalysis),
        script_dialogue: payload.scriptDialogue || '',
        voice_activity: JSON.stringify(voiceAnalysis),
      },
    })
    const completion = await executeAiVisionStep({
      userId: job.data.userId,
      model: analysisModel,
      prompt,
      imageUrls: await frameDataUrls(frames),
      projectId: job.data.projectId,
      action: 'environment_sound_analysis',
      meta: {
        stepId: 'environment_sound_analysis',
        stepTitle: 'Environment sound analysis',
        stepIndex: 1,
        stepTotal: 1,
      },
      temperature: 0.2,
    })
    const plan = parseEnvironmentSoundPlan(safeParseJsonObject(completion.text))
    assertDurationMatches(plan.durationSeconds, videoProbe.durationSeconds, 'ENVIRONMENT_SOUND_ANALYSIS_DURATION_MISMATCH')

    await reportTaskProgress(job, 95, { stage: 'environment_sound_plan_ready' })
    return {
      plan,
      video: {
        key: payload.videoKey,
        name: payload.videoName,
        durationSeconds: videoProbe.durationSeconds,
        hasSourceAudio: videoProbe.hasAudio,
        frameCount: frames.length,
      },
      voiceActivity,
      voiceAnalysis,
      sourceAudioActivity,
      sourceAudioAnalysis,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

export async function handleEnvironmentSoundGenerateTask(job: Job<TaskJobData>) {
  const payload = readGenerateSubmission(job)
  const provider = await getProviderConfig(job.data.userId, 'comfyui')
  const baseUrl = provider.baseUrl?.trim()
  if (!baseUrl) throw new Error('COMFYUI_BASE_URL_MISSING')

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waoo-environment-generate-'))
  const videoPath = path.join(tempDir, `source${sourceExtension(payload.videoName, '.mp4')}`)
  const outputPath = path.join(tempDir, 'environment-sound.mp3')

  try {
    await reportTaskProgress(job, 10, { stage: 'environment_sound_prepare' })
    await downloadEnvironmentSoundSource(await getSignedObjectUrl(payload.videoKey), videoPath)
    const videoProbe = await probeEnvironmentSoundMedia(videoPath)
    assertEnvironmentSoundVideoDuration(videoProbe.durationSeconds)
    assertDurationMatches(videoProbe.durationSeconds, payload.plan.durationSeconds, 'ENVIRONMENT_SOUND_VIDEO_PLAN_MISMATCH')

    await reportTaskProgress(job, 13, { stage: 'environment_sound_prompt_sync' })
    const synchronizedPlan = await synchronizeEnvironmentSoundPrompts(job, payload.plan)
    const pieces = buildEnvironmentSoundPieces(synchronizedPlan)
    const piecePaths: string[] = []
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]!
      await reportTaskProgress(job, 15 + Math.floor(index / pieces.length * 65), {
        stage: 'environment_sound_generate',
        piece: index + 1,
        pieceCount: pieces.length,
      })
      const generated = await runComfyUiAudioWorkflow({
        baseUrl,
        workflowKey: STABLE_AUDIO_3_MEDIUM_WORKFLOW_KEY,
        prompt: piece.promptEn,
        negativePrompt: piece.negativePromptEn,
        durationSeconds: piece.generationDurationSeconds,
        seed: piece.seed,
      })
      if (!generated.mimeType.startsWith('audio/')) throw new Error('ENVIRONMENT_SOUND_COMFYUI_MIME_INVALID')
      const piecePath = path.join(tempDir, `piece-${String(index + 1).padStart(3, '0')}.mp3`)
      await fs.writeFile(piecePath, Buffer.from(generated.audioBase64, 'base64'))
      const pieceProbe = await probeEnvironmentSoundMedia(piecePath)
      if (!pieceProbe.hasAudio) throw new Error('ENVIRONMENT_SOUND_PIECE_AUDIO_MISSING')
      assertDurationMatches(
        pieceProbe.durationSeconds,
        piece.generationDurationSeconds,
        'ENVIRONMENT_SOUND_PIECE_DURATION_MISMATCH',
      )
      const pieceLevel = await measureEnvironmentSoundAudioLevel(piecePath)
      if (!Number.isFinite(pieceLevel.maxVolumeDb) || pieceLevel.maxVolumeDb <= -80) {
        throw new Error('ENVIRONMENT_SOUND_PIECE_SILENT')
      }
      piecePaths.push(piecePath)
    }

    await reportTaskProgress(job, 85, { stage: 'environment_sound_compose' })
    await composeEnvironmentSoundMp3({
      inputPaths: piecePaths,
      transitions: pieces.slice(0, -1).map((piece) => piece.transitionSeconds),
      outputPath,
      durationSeconds: payload.plan.durationSeconds,
    })
    const outputProbe = await probeEnvironmentSoundMedia(outputPath)
    if (!outputProbe.hasAudio) throw new Error('ENVIRONMENT_SOUND_OUTPUT_AUDIO_MISSING')
    assertDurationMatches(outputProbe.durationSeconds, payload.plan.durationSeconds, 'ENVIRONMENT_SOUND_OUTPUT_DURATION_MISMATCH')

    await reportTaskProgress(job, 95, { stage: 'environment_sound_persist' })
    const audioKey = buildEnvironmentSoundOutputKey(job.data.userId)
    await uploadObject(await fs.readFile(outputPath), audioKey, 1, 'audio/mpeg')
    let cleanup: Awaited<ReturnType<typeof scheduleEnvironmentSoundCleanup>>
    try {
      cleanup = await scheduleEnvironmentSoundCleanup({
        userId: job.data.userId,
        locale: job.data.locale,
        objectKey: audioKey,
      })
    } catch (error) {
      await deleteObject(audioKey).catch(() => undefined)
      throw error
    }
    return {
      audioKey,
      audioUrl: getSignedUrl(audioKey),
      mimeType: 'audio/mpeg',
      durationSeconds: outputProbe.durationSeconds,
      pieceCount: pieces.length,
      seeds: pieces.map((piece) => piece.seed),
      plan: synchronizedPlan,
      expiresAt: cleanup.expiresAt,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

export async function handleEnvironmentSoundCleanupTask(job: Job<TaskJobData>) {
  const objectKey = typeof job.data.payload?.objectKey === 'string'
    ? job.data.payload.objectKey.trim()
    : ''
  if (!objectKey) throw new Error('ENVIRONMENT_SOUND_CLEANUP_OBJECT_REQUIRED')
  if (!isOwnedEnvironmentSoundTemporaryObjectKey(job.data.userId, objectKey)) {
    throw new Error('ENVIRONMENT_SOUND_CLEANUP_OBJECT_NOT_OWNED')
  }
  await deleteObject(objectKey)
  return { deleted: true, objectKey }
}
