import type { Job } from 'bullmq'
import type { NextRequest } from 'next/server'
import {
  generateProjectEditCinematographyShotPlan,
  generateProjectEditDirectorDecoupage,
} from '@/lib/edit-script/service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

export async function handleEditDirectorDecoupageGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const screenplayId = readText(payload.screenplayId) || readText(job.data.targetId)
  if (!episodeId) throw new Error('episodeId is required')
  if (!screenplayId) throw new Error('screenplayId is required')

  await reportTaskProgress(job, 12, {
    stage: 'edit_director_decoupage_prepare',
    stageLabel: 'progress.stage.editScriptPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_director_decoupage_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_director_decoupage_generate')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const directorDecoupage = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await generateProjectEditDirectorDecoupage({
        request: createWorkerRequest(job, 'edit-director-decoupage-generate'),
        projectId: job.data.projectId,
        userId: job.data.userId,
        episodeId,
        screenplayId,
        locale: job.data.locale,
      }),
    )

    await reportTaskProgress(job, 96, {
      stage: 'edit_director_decoupage_persist',
      stageLabel: 'progress.stage.editScriptPersist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_director_decoupage_persist')

    return {
      directorDecoupageId: directorDecoupage.id,
      episodeId,
      screenplayId: directorDecoupage.screenplayId,
      shotCount: directorDecoupage.shots.length,
    }
  } finally {
    await streamCallbacks.flush()
  }
}

export async function handleEditCinematographyShotPlanGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const editScriptId = readText(payload.editScriptId) || readText(job.data.targetId)
  if (!episodeId) throw new Error('episodeId is required')
  if (!editScriptId) throw new Error('editScriptId is required')

  await reportTaskProgress(job, 12, {
    stage: 'edit_cinematography_shot_plan_prepare',
    stageLabel: 'progress.stage.editScriptPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_cinematography_shot_plan_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_cinematography_shot_plan_generate')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const cinematographyShotPlan = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await generateProjectEditCinematographyShotPlan({
        request: createWorkerRequest(job, 'edit-cinematography-shot-plan-generate'),
        projectId: job.data.projectId,
        userId: job.data.userId,
        episodeId,
        editScriptId,
        locale: job.data.locale,
      }),
    )

    await reportTaskProgress(job, 96, {
      stage: 'edit_cinematography_shot_plan_persist',
      stageLabel: 'progress.stage.editScriptPersist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_cinematography_shot_plan_persist')

    return {
      cinematographyShotPlanId: cinematographyShotPlan.id,
      episodeId,
      editScriptId: cinematographyShotPlan.editScriptId,
      shotCount: cinematographyShotPlan.shots.length,
    }
  } finally {
    await streamCallbacks.flush()
  }
}
