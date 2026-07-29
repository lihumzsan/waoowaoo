import { Worker, type Job } from 'bullmq'
import { generateVoice } from '@/lib/ai-exec/engine'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { parseCreativeResourceGenerationTaskPayload } from '@/lib/creative-resource/generation-contract'
import { queueRedis } from '@/lib/redis'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { getTaskDefinitionForQueue, type VoiceTaskHandlerKey } from '@/lib/task/definition'
import { QUEUE_NAME } from '@/lib/task/queues'
import type { TaskJobData } from '@/lib/task/types'
import { extensionFromAudioMimeType, loadGeneratedAudio } from './audio-artifact'
import { getWorkerConcurrency } from './runtime-config'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { assertTaskActive } from './utils'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`VOICE_GENERATE_${field.toUpperCase()}_REQUIRED`)
  }
  return value.trim()
}

export async function handleVoiceGenerateTask(job: Job<TaskJobData>) {
  const payload = parseCreativeResourceGenerationTaskPayload(job.data.payload)
  const voiceModel = readRequiredString(payload.voiceModel, 'voiceModel')
  const description = readRequiredString(payload.prompt, 'description')
  const previewText = readRequiredString(payload.previewText, 'previewText')
  const language = readRequiredString(payload.language, 'language')

  await reportTaskProgress(job, 20, { stage: 'generate_voice_submit' })
  const generated = await generateVoice(
    job.data.userId,
    voiceModel,
    description,
    previewText,
    { language },
    { key: 'media:voice:primary' },
    {
      // 与 image/video 参照物（workers/utils.ts waitExternalResult）对齐：
      // beforePoll 做任务取消检查，onPending 上报真实排队/生成阶段与进度。
      beforePoll: async () => await assertTaskActive(job, 'polling_external'),
      onPending: async ({ elapsedRatio, phase }) => {
        const progress = 30 + Math.floor((80 - 30) * elapsedRatio)
        await reportTaskProgress(job, progress, { stage: 'polling_external', externalPhase: phase })
        await assertTaskActive(job, 'polling_external_wait')
      },
    },
  )
  if (!generated.success) {
    throw new Error(generated.error || 'VOICE_GENERATE_PROVIDER_FAILED')
  }

  await reportTaskProgress(job, 85, { stage: 'persist_voice' })
  const audio = await loadGeneratedAudio({
    audioBase64: generated.audioBase64,
    audioUrl: generated.audioUrl,
    mimeType: generated.audioMimeType,
    label: 'generated voice',
    errorPrefix: 'VOICE_GENERATE',
  })
  const storageKey = await uploadObject(
    audio.buffer,
    buildTaskArtifactStorageKey({
      taskId: job.data.taskId,
      artifact: 'voice:primary',
      extension: extensionFromAudioMimeType(audio.mimeType),
    }),
    1,
    audio.mimeType,
  )
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: audio.mimeType,
    sizeBytes: audio.buffer.byteLength,
    durationMs: null,
  })

  return {
    mediaId: media.id,
    audioUrl: media.url,
    storageKey,
    modelKey: voiceModel,
    voiceModel,
    provider: voiceModel.split('::')[0] || null,
    actualCharacters: Array.from(previewText).length,
    metadata: generated.metadata || {},
  }
}

type VoiceTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const VOICE_TASK_HANDLERS = {
  creative_resource_voice: handleVoiceGenerateTask,
} satisfies Record<VoiceTaskHandlerKey, VoiceTaskHandler>

async function processVoiceTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })
  const definition = getTaskDefinitionForQueue(job.data.type, 'voice')
  return await VOICE_TASK_HANDLERS[definition.workerHandler](job)
}

export function createVoiceWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VOICE,
    async (job) => await withTaskLifecycle(job, processVoiceTask),
    {
      connection: queueRedis,
      concurrency: getWorkerConcurrency('voice'),
    },
  )
}
