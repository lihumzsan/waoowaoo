import type { Job } from 'bullmq'
import type { NextRequest } from 'next/server'
import { generateProjectEditScript } from '@/lib/edit-script/service'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskJobData } from '@/lib/task/types'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readVideoRatio(value: unknown): EditScriptVideoRatio | null {
  return value === '9:16' || value === '16:9' || value === '21:9' ? value : null
}

function createWorkerRequest(job: Job<TaskJobData>): NextRequest {
  const headers = new Headers()
  headers.set('accept-language', job.data.locale)
  if (job.data.trace?.requestId) headers.set('x-request-id', job.data.trace.requestId)
  return new Request('http://localhost/internal/tasks/edit-script-generate', {
    method: 'POST',
    headers,
  }) as NextRequest
}

export async function handleEditScriptGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const screenplayId = readText(payload.screenplayId)
  const videoRatio = readVideoRatio(payload.videoRatio)
  if (Object.prototype.hasOwnProperty.call(payload, 'artStyle')) {
    throw new Error('LEGACY_ART_STYLE_REMOVED')
  }
  if (!episodeId) throw new Error('episodeId is required')

  await reportTaskProgress(job, 12, {
    stage: 'edit_script_prepare',
    stageLabel: 'progress.stage.editScriptPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_script_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_script_generate')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const editScript = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await generateProjectEditScript({
        request: createWorkerRequest(job),
        projectId: job.data.projectId,
        userId: job.data.userId,
        episodeId,
        locale: job.data.locale,
        ...(screenplayId ? { screenplayId } : {}),
        ...(videoRatio ? { videoRatio } : {}),
        onGenerationStepPersisted: async (step) => {
          await reportTaskProgress(job, step.progress, {
            stage: step.stage,
            stageLabel: step.stageLabel,
            displayMode: 'detail',
          })
          await assertTaskActive(job, step.stage)
        },
      }),
    )

    await reportTaskProgress(job, 96, {
      stage: 'edit_script_persist',
      stageLabel: 'progress.stage.editScriptPersist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_script_persist')

    return {
      editScriptId: editScript.id ?? null,
      episodeId,
      durationSec: editScript.durationSec,
      shotCount: editScript.shotCount,
      requirementCount: editScript.requirements.length,
      generationSegmentCount: editScript.generationSegments.length,
    }
  } finally {
    await streamCallbacks.flush()
  }
}
