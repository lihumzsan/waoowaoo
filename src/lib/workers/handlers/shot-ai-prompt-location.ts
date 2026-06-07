import type { Job } from 'bullmq'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskJobData } from '@/lib/task/types'
import {
  persistLocationDescription,
  requireProjectLocation,
  resolveAnalysisModel,
} from './shot-ai-persist'
import { runShotPromptCompletion } from './shot-ai-prompt-runtime'
import { parseJsonObject, readRequiredString, type AnyObj } from './shot-ai-prompt-utils'
import { buildAiPrompt as buildPrompt, AI_PROMPT_IDS as PROMPT_IDS } from '@/lib/ai-prompts'

export async function handleModifyLocationTask(job: Job<TaskJobData>, payload: AnyObj) {
  const locationId = readRequiredString(payload.locationId, 'locationId')
  const imageIndexValue = Number(payload.imageIndex ?? 0)
  const imageIndex = Number.isFinite(imageIndexValue) ? Math.max(0, Math.floor(imageIndexValue)) : 0
  const currentDescription = readRequiredString(payload.currentDescription, 'currentDescription')
  const modifyInstruction = readRequiredString(payload.modifyInstruction, 'modifyInstruction')
  const projectWorkflow = await resolveAnalysisModel(job.data.projectId, job.data.userId)
  const location = await requireProjectLocation(locationId, job.data.projectId)

  const finalPrompt = buildPrompt({
    promptId: PROMPT_IDS.LOCATION_MODIFY,
    locale: job.data.locale,
    variables: {
      location_name: location.name,
      location_input: currentDescription,
      user_input: modifyInstruction,
    },
  })

  await reportTaskProgress(job, 22, {
    stage: 'ai_modify_location_prepare',
    stageLabel: '准备场景描述修改参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'ai_modify_location_prepare')

  const responseText = await runShotPromptCompletion({
    job,
    model: projectWorkflow.analysisModel,
    prompt: finalPrompt,
    action: 'ai_modify_location',
    streamContextKey: 'ai_modify_location',
    streamStepId: 'ai_modify_location',
    streamStepTitle: '场景描述修改',
  })
  await assertTaskActive(job, 'ai_modify_location_parse')

  const parsed = parseJsonObject(responseText)
  const prompt = readRequiredString(parsed.prompt, 'prompt')
  const modifiedDescription = removeLocationPromptSuffix(prompt)

  await assertTaskActive(job, 'ai_modify_location_persist')
  const updatedLocation = await persistLocationDescription({
    locationId,
    imageIndex,
    modifiedDescription,
  })

  await reportTaskProgress(job, 96, {
    stage: 'ai_modify_location_done',
    stageLabel: '场景描述修改完成',
    displayMode: 'detail',
    meta: { locationId, imageIndex },
  })

  return {
    success: true,
    prompt,
    modifiedDescription,
    location: updatedLocation,
  }
}
