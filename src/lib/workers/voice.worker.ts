import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { generateVoiceLine } from '@/lib/voice/generate-voice-line'
import { generateFreeVoiceVersion } from '@/lib/voice/free-voice'
import { generateVideoToolFreeVoice, VIDEO_TOOL_FREE_VOICE_TARGET_TYPE } from '@/lib/video-tools/free-voice'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { handleVoiceDesignTask } from './handlers/voice-design'

type AnyObj = Record<string, unknown>

async function handleVoiceLineTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lineId = typeof payload.lineId === 'string' ? payload.lineId : job.data.targetId
  const episodeId = typeof payload.episodeId === 'string' ? payload.episodeId : job.data.episodeId
  const audioModel = typeof payload.audioModel === 'string' && payload.audioModel.trim()
    ? payload.audioModel.trim()
    : undefined
  if (!lineId) {
    throw new Error('VOICE_LINE task missing lineId')
  }
  if (!episodeId) {
    throw new Error('VOICE_LINE task missing episodeId')
  }

  await reportTaskProgress(job, 20, { stage: 'generate_voice_submit', lineId })

  const generated = await generateVoiceLine({
    projectId: job.data.projectId,
    episodeId,
    lineId,
    userId: job.data.userId,
    locale: job.data.locale,
    audioModel,
  })

  await reportTaskProgress(job, 95, { stage: 'generate_voice_persist', lineId })

  return generated
}

async function processVoiceTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VOICE_LINE:
      return await handleVoiceLineTask(job)
    case TASK_TYPE.FREE_VOICE: {
      const versionId = job.data.targetId
      if (!versionId) throw new Error('FREE_VOICE task missing versionId')
      if (job.data.targetType === VIDEO_TOOL_FREE_VOICE_TARGET_TYPE) {
        const payload = (job.data.payload || {}) as AnyObj
        const text = typeof payload.text === 'string' ? payload.text : ''
        const referenceAudioUrl = typeof payload.referenceAudioUrl === 'string' ? payload.referenceAudioUrl : ''
        const audioModel = typeof payload.audioModel === 'string' ? payload.audioModel : null
        await reportTaskProgress(job, 20, { stage: 'generate_free_voice_submit', recordId: versionId })
        const generated = await generateVideoToolFreeVoice({
          recordId: versionId,
          userId: job.data.userId,
          locale: job.data.locale,
          text,
          referenceAudioUrl,
          audioModel,
        })
        await reportTaskProgress(job, 95, { stage: 'generate_free_voice_persist', recordId: versionId })
        return generated
      }
      await reportTaskProgress(job, 20, { stage: 'generate_free_voice_submit', versionId })
      const generated = await generateFreeVoiceVersion({
        projectId: job.data.projectId,
        versionId,
        userId: job.data.userId,
        locale: job.data.locale,
      })
      await reportTaskProgress(job, 95, { stage: 'generate_free_voice_persist', versionId })
      return generated
    }
    case TASK_TYPE.VOICE_DESIGN:
    case TASK_TYPE.ASSET_HUB_VOICE_DESIGN:
      return await handleVoiceDesignTask(job)
    default:
      throw new Error(`Unsupported voice task type: ${job.data.type}`)
  }
}

export function createVoiceWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VOICE,
    async (job) => await withTaskLifecycle(job, processVoiceTask),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VOICE || '10', 10) || 10,
    },
  )
}
