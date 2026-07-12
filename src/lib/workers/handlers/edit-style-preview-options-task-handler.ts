import type { Job } from 'bullmq'
import { generateProjectEditStylePreviewOptions } from '@/lib/edit-script/service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`)
  }
  return value
}

export async function handleEditStylePreviewOptionsTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  if (job.data.targetType !== 'ProjectEditBible') {
    throw new Error(`EDIT_STYLE_PREVIEW_OPTIONS_TARGET_INVALID:${job.data.targetType}`)
  }
  const bibleId = readRequiredString(payload.bibleId ?? job.data.targetId, 'bibleId')
  if (bibleId !== job.data.targetId) {
    throw new Error(`EDIT_STYLE_PREVIEW_OPTIONS_TARGET_MISMATCH:${bibleId}:${job.data.targetId}`)
  }
  const episodeId = readRequiredString(payload.episodeId ?? job.data.episodeId, 'episodeId')
  const model = readRequiredString(payload.analysisModel, 'analysisModel')
  const count = readPositiveInteger(payload.count, 'count')
  const generation = readPositiveInteger(payload.generation, 'generation')
  const styleDirection = typeof payload.styleDirection === 'string' ? payload.styleDirection.trim() : ''

  await reportTaskProgress(job, 15, {
    stage: 'edit_style_preview_options_prepare',
    stageLabel: 'progress.stage.editStylePreviewOptionsPrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_style_preview_options_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_style_preview_options_generate')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    await reportTaskProgress(job, 35, {
      stage: 'edit_style_preview_options_generate',
      stageLabel: 'progress.stage.editStylePreviewOptionsGenerate',
      displayMode: 'detail',
    })
    const generated = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await generateProjectEditStylePreviewOptions({
        projectId: job.data.projectId,
        episodeId,
        userId: job.data.userId,
        bibleId,
        taskId: job.data.taskId,
        model,
        locale: job.data.locale,
        count,
        generation,
        ...(styleDirection ? { styleDirection } : {}),
        onOptionsGenerated: async () => {
          await reportTaskProgress(job, 90, {
            stage: 'edit_style_preview_options_persist',
            stageLabel: 'progress.stage.editStylePreviewOptionsPersist',
            displayMode: 'detail',
          })
          await assertTaskActive(job, 'edit_style_preview_options_persist')
        },
      }),
    )

    await reportTaskProgress(job, 95, {
      stage: 'edit_style_preview_options_persist',
      stageLabel: 'progress.stage.editStylePreviewOptionsPersist',
      displayMode: 'detail',
    })
    return {
      bibleId: generated.bibleId,
      stylePreviewIds: generated.previews.map((preview) => preview.id),
      count: generated.previews.length,
      generation,
    }
  } finally {
    await streamCallbacks.flush()
  }
}
