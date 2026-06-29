import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'
import { TASK_TYPE } from '@/lib/task/types'
import {
  composeEditImagePrompts,
  composeEditVideoPrompts,
} from '@/lib/edit-script/prompt-composer/service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parsePromptComposerPayload(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const editScriptId = readText(payload.editScriptId) || readText(job.data.targetId)
  const analysisModel = readText(payload.analysisModel)
  if (!episodeId) throw new Error('PROMPT_COMPOSER_EPISODE_ID_REQUIRED')
  if (!editScriptId) throw new Error('PROMPT_COMPOSER_EDIT_SCRIPT_ID_REQUIRED')
  if (!analysisModel) throw new Error('PROMPT_COMPOSER_ANALYSIS_MODEL_REQUIRED')
  return { episodeId, editScriptId, analysisModel }
}

export async function handleEditImagePromptComposeTask(job: Job<TaskJobData>) {
  const parsed = parsePromptComposerPayload(job)
  await reportTaskProgress(job, 12, {
    stage: 'edit_image_prompt_compose_prepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_image_prompt_compose_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_image_prompt_compose')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const result = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => {
        await reportTaskProgress(job, 45, {
          stage: 'edit_image_prompt_compose_generate',
          displayMode: 'detail',
        })
        return await composeEditImagePrompts({
          projectId: job.data.projectId,
          episodeId: parsed.episodeId,
          editScriptId: parsed.editScriptId,
          userId: job.data.userId,
          locale: job.data.locale,
          analysisModel: parsed.analysisModel,
        })
      },
    )

    await reportTaskProgress(job, 92, {
      stage: 'edit_image_prompt_compose_persist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_image_prompt_compose_persist')
    return {
      editScriptId: parsed.editScriptId,
      episodeId: parsed.episodeId,
      panelCount: result.panelCount,
      taskType: TASK_TYPE.EDIT_IMAGE_PROMPT_COMPOSE,
    }
  } finally {
    await streamCallbacks.flush()
  }
}

export async function handleEditVideoPromptComposeTask(job: Job<TaskJobData>) {
  const parsed = parsePromptComposerPayload(job)
  await reportTaskProgress(job, 12, {
    stage: 'edit_video_prompt_compose_prepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_video_prompt_compose_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'edit_video_prompt_compose')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    const result = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => {
        await reportTaskProgress(job, 45, {
          stage: 'edit_video_prompt_compose_generate',
          displayMode: 'detail',
        })
        return await composeEditVideoPrompts({
          projectId: job.data.projectId,
          episodeId: parsed.episodeId,
          editScriptId: parsed.editScriptId,
          userId: job.data.userId,
          locale: job.data.locale,
          analysisModel: parsed.analysisModel,
        })
      },
    )

    await reportTaskProgress(job, 92, {
      stage: 'edit_video_prompt_compose_persist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_video_prompt_compose_persist')
    return {
      editScriptId: parsed.editScriptId,
      episodeId: parsed.episodeId,
      panelCount: result.panelCount,
      videoGroupCount: result.videoGroupCount,
      taskType: TASK_TYPE.EDIT_VIDEO_PROMPT_COMPOSE,
    }
  } finally {
    await streamCallbacks.flush()
  }
}
