import type { Job } from 'bullmq'
import type { NextRequest } from 'next/server'
import {
  generateProjectEditScreenplay,
  reviseProjectEditScreenplay,
} from '@/lib/edit-script/service'
import type { EditFirstDurationTier } from '@/lib/edit-script/duration-tier'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readDurationTier(value: unknown): EditFirstDurationTier | null {
  return value === 'short' || value === 'medium' || value === 'long' ? value : null
}

function readVideoRatio(value: unknown): EditScriptVideoRatio | null {
  return value === '9:16' || value === '16:9' || value === '21:9' ? value : null
}

function createWorkerRequest(job: Job<TaskJobData>, path: string): NextRequest {
  const headers = new Headers()
  headers.set('accept-language', job.data.locale)
  if (job.data.trace?.requestId) headers.set('x-request-id', job.data.trace.requestId)
  return new Request(`http://localhost/internal/tasks/${path}`, {
    method: 'POST',
    headers,
  }) as NextRequest
}

export async function handleEditScreenplayGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const screenplayId = readText(payload.screenplayId) || readText(job.data.targetId)
  const prompt = readText(payload.prompt)
  const durationTier = readDurationTier(payload.durationTier)
  const aspectRatio = readVideoRatio(payload.aspectRatio)
  if (!episodeId) throw new Error('episodeId is required')
  if (!screenplayId) throw new Error('screenplayId is required')
  if (!prompt) throw new Error('prompt is required')
  if (!durationTier) throw new Error('durationTier is required')
  if (!aspectRatio) throw new Error('aspectRatio is required')

  await reportTaskProgress(job, 12, {
    stage: 'edit_screenplay_prepare',
    stageLabel: 'progress.stage.editScreenplayPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_screenplay_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_screenplay_generate')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const screenplay = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await generateProjectEditScreenplay({
        request: createWorkerRequest(job, 'edit-screenplay-generate'),
        projectId: job.data.projectId,
        userId: job.data.userId,
        episodeId,
        locale: job.data.locale,
        prompt,
        durationTier,
        aspectRatio,
      }),
    )

    await reportTaskProgress(job, 96, {
      stage: 'edit_screenplay_persist',
      stageLabel: 'progress.stage.editScreenplayPersist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_screenplay_persist')

    return {
      screenplayId: screenplay.id,
      episodeId,
      status: screenplay.status,
      screenplayTextLength: screenplay.screenplayText.length,
    }
  } finally {
    await streamCallbacks.flush()
  }
}

export async function handleEditScreenplayReviseTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const screenplayId = readText(payload.screenplayId) || readText(job.data.targetId)
  const revisionInstruction = readText(payload.revisionInstruction)
  const durationTier = readDurationTier(payload.durationTier)
  const aspectRatio = readVideoRatio(payload.aspectRatio)
  if (!episodeId) throw new Error('episodeId is required')
  if (!screenplayId) throw new Error('screenplayId is required')
  if (!revisionInstruction) throw new Error('revisionInstruction is required')
  if (!durationTier) throw new Error('durationTier is required')
  if (!aspectRatio) throw new Error('aspectRatio is required')

  await reportTaskProgress(job, 12, {
    stage: 'edit_screenplay_revision_prepare',
    stageLabel: 'progress.stage.editScreenplayRevisionPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_screenplay_revision_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_screenplay_revise')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const screenplay = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await reviseProjectEditScreenplay({
        request: createWorkerRequest(job, 'edit-screenplay-revise'),
        projectId: job.data.projectId,
        userId: job.data.userId,
        episodeId,
        locale: job.data.locale,
        screenplayId,
        revisionInstruction,
        durationTier,
        aspectRatio,
      }),
    )

    await reportTaskProgress(job, 96, {
      stage: 'edit_screenplay_revision_persist',
      stageLabel: 'progress.stage.editScreenplayRevisionPersist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_screenplay_revision_persist')

    return {
      screenplayId: screenplay.id,
      episodeId,
      status: screenplay.status,
      screenplayTextLength: screenplay.screenplayText.length,
    }
  } finally {
    await streamCallbacks.flush()
  }
}
