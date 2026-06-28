import type { Job } from 'bullmq'
import type { NextRequest } from 'next/server'
import {
  generateProjectEditShotExecutionPlan,
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

export async function handleEditShotExecutionPlanGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const editScriptId = readText(payload.editScriptId) || readText(job.data.targetId)
  if (!episodeId) throw new Error('episodeId is required')
  if (!editScriptId) throw new Error('editScriptId is required')

  await reportTaskProgress(job, 12, {
    stage: 'edit_shot_execution_plan_prepare',
    stageLabel: 'progress.stage.editScriptPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_shot_execution_plan_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_shot_execution_plan_generate')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const shotExecutionPlan = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await generateProjectEditShotExecutionPlan({
        request: createWorkerRequest(job, 'edit-shot-execution-plan-generate'),
        projectId: job.data.projectId,
        userId: job.data.userId,
        episodeId,
        editScriptId,
        locale: job.data.locale,
      }),
    )

    await reportTaskProgress(job, 96, {
      stage: 'edit_shot_execution_plan_persist',
      stageLabel: 'progress.stage.editScriptPersist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_shot_execution_plan_persist')

    return {
      shotExecutionPlanId: shotExecutionPlan.id,
      episodeId,
      editScriptId: shotExecutionPlan.editScriptId,
      shotCount: shotExecutionPlan.shots.length,
    }
  } finally {
    await streamCallbacks.flush()
  }
}
