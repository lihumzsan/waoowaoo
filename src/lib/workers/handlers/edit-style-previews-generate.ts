import type { Job } from 'bullmq'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  generateProjectEditStylePreviews,
  markProjectEditStylePreviewGenerationFailed,
} from '@/lib/edit-script/service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { TASK_STATUS, TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

const CHILD_POLL_INTERVAL_MS = 2_000
const WAIT_PROGRESS_START = 72
const WAIT_PROGRESS_SPAN = 24

type StylePreviewChildTask = {
  readonly id: string
  readonly status: string
  readonly targetId: string
  readonly errorCode: string | null
  readonly errorMessage: string | null
}

type StylePreviewChildSummary = {
  readonly total: number
  readonly completed: number
  readonly failed: number
  readonly taskIds: readonly string[]
  readonly previewIds: readonly string[]
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

function isTerminalTaskStatus(status: string): boolean {
  return (
    status === TASK_STATUS.COMPLETED
    || status === TASK_STATUS.FAILED
    || status === TASK_STATUS.CANCELED
    || status === TASK_STATUS.DISMISSED
  )
}

async function readStylePreviewChildTasks(parentTaskId: string): Promise<readonly StylePreviewChildTask[]> {
  return await prisma.task.findMany({
    where: {
      parentTaskId,
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
    },
    select: {
      id: true,
      status: true,
      targetId: true,
      errorCode: true,
      errorMessage: true,
    },
    orderBy: { createdAt: 'asc' },
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function failBibleStylePreviewsWhenAllImagesFailed(params: {
  readonly bibleId: string
  readonly childTasks: readonly StylePreviewChildTask[]
}) {
  const messages = params.childTasks
    .map((task) => task.errorMessage?.trim())
    .filter((message): message is string => Boolean(message))
  await markProjectEditStylePreviewGenerationFailed({
    bibleId: params.bibleId,
    message: messages[0] || 'All edit style preview image tasks failed',
  })
}

async function waitForStylePreviewImageTasks(params: {
  readonly job: Job<TaskJobData>
  readonly bibleId: string
}): Promise<StylePreviewChildSummary> {
  while (true) {
    await assertTaskActive(params.job, 'edit_style_previews_wait_images')
    const childTasks = await readStylePreviewChildTasks(params.job.data.taskId)
    if (childTasks.length === 0) {
      throw new Error(`EDIT_STYLE_PREVIEWS_CHILD_TASKS_MISSING:${params.job.data.taskId}`)
    }

    const terminalTasks = childTasks.filter((task) => isTerminalTaskStatus(task.status))
    const completedTasks = childTasks.filter((task) => task.status === TASK_STATUS.COMPLETED)
    const failedTasks = terminalTasks.filter((task) => task.status !== TASK_STATUS.COMPLETED)
    const progress = WAIT_PROGRESS_START + Math.floor((terminalTasks.length / childTasks.length) * WAIT_PROGRESS_SPAN)

    await reportTaskProgress(params.job, progress, {
      stage: 'edit_style_previews_wait_images',
      stageLabel: 'progress.stage.editStylePreviewsWaitImages',
      displayMode: 'detail',
      childTaskTotal: childTasks.length,
      childTaskCompleted: completedTasks.length,
      childTaskFailed: failedTasks.length,
    })

    if (terminalTasks.length === childTasks.length) {
      if (completedTasks.length === 0) {
        await failBibleStylePreviewsWhenAllImagesFailed({
          bibleId: params.bibleId,
          childTasks,
        })
        throw new Error(`EDIT_STYLE_PREVIEWS_ALL_IMAGES_FAILED:${params.bibleId}`)
      }
      return {
        total: childTasks.length,
        completed: completedTasks.length,
        failed: failedTasks.length,
        taskIds: childTasks.map((task) => task.id),
        previewIds: childTasks.map((task) => task.targetId),
      }
    }

    await sleep(CHILD_POLL_INTERVAL_MS)
  }
}

export async function handleEditStylePreviewsGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const bibleId = readText(payload.bibleId) || readText(job.data.targetId)
  const styleDirection = readText(payload.styleDirection)
  const count = readCount(payload.count)
  const plannedStylePreviewIds = readStringArray(payload.plannedStylePreviewIds)
  const plannedImageModel = readText(payload.plannedImageModel)
  const confirmedMaxCost = readFiniteNumber(payload.confirmedMaxCost)

  if (!episodeId) throw new Error('episodeId is required')
  if (!bibleId) throw new Error('bibleId is required')
  const operationConfirmed = job.data.operationConfirmed === true
  if (
    job.data.operationId !== 'generate_edit_style_previews'
    || !operationConfirmed
  ) {
    throw new Error('EDIT_STYLE_PREVIEW_BILLABLE_MEDIA_APPROVAL_REQUIRED')
  }

  await reportTaskProgress(job, 12, {
    stage: 'edit_style_previews_prepare',
    stageLabel: 'progress.stage.editStylePreviewsPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_style_previews_prepare')

  const existingChildren = await readStylePreviewChildTasks(job.data.taskId)
  if (existingChildren.length === 0) {
    await reportTaskProgress(job, 24, {
      stage: 'edit_style_previews_generate_text',
      stageLabel: 'progress.stage.editStylePreviewsGenerateText',
      displayMode: 'detail',
    })

    const streamContext = createWorkerLLMStreamContext(job, 'edit_style_previews_generate')
    const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
    try {
      await withInternalLLMStreamCallbacks(
        streamCallbacks,
        async () => await generateProjectEditStylePreviews({
          request: createWorkerRequest(job, 'edit-style-previews-generate'),
          projectId: job.data.projectId,
          userId: job.data.userId,
          episodeId,
          locale: job.data.locale,
          bibleId,
          parentTaskId: job.data.taskId,
          operationConfirmed,
          operationRequestId: job.data.operationRequestId || job.data.trace?.requestId || null,
          ...(plannedStylePreviewIds.length > 0 ? { plannedStylePreviewIds } : {}),
          ...(plannedImageModel ? { plannedImageModel } : {}),
          ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
          ...(styleDirection ? { styleDirection } : {}),
          ...(count ? { count } : {}),
        }),
      )
    } finally {
      await streamCallbacks.flush()
    }

    await reportTaskProgress(job, 68, {
      stage: 'edit_style_previews_submit_images',
      stageLabel: 'progress.stage.editStylePreviewsSubmitImages',
      displayMode: 'detail',
    })
  }

  const childSummary = await waitForStylePreviewImageTasks({ job, bibleId })

  return {
    bibleId,
    episodeId,
    status: 'confirmed',
    total: childSummary.total,
    completed: childSummary.completed,
    failed: childSummary.failed,
    taskIds: childSummary.taskIds,
    previewIds: childSummary.previewIds,
  }
}
