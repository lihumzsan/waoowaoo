import type { Job } from 'bullmq'
import { removeCharacterPromptSuffix } from '@/lib/constants'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskJobData } from '@/lib/task/types'
import { resolveAnalysisModel } from './shot-ai-persist'
import { runShotPromptCompletion } from './shot-ai-prompt-runtime'
import { readRequiredString, type AnyObj } from './shot-ai-prompt-utils'
import { buildAiPrompt as buildPrompt, AI_PROMPT_IDS as PROMPT_IDS } from '@/lib/ai-prompts'

export async function handleModifyAppearanceTask(job: Job<TaskJobData>, payload: AnyObj) {
  const characterId = readRequiredString(payload.characterId, 'characterId')
  const appearanceId = readRequiredString(payload.appearanceId, 'appearanceId')
  const currentDescription = readRequiredString(payload.currentDescription, 'currentDescription')
  const modifyInstruction = readRequiredString(payload.modifyInstruction, 'modifyInstruction')
  const projectWorkflow = await resolveAnalysisModel(job.data.projectId, job.data.userId)

  const finalPrompt = buildPrompt({
    promptId: PROMPT_IDS.CHARACTER_MODIFY,
    locale: job.data.locale,
    variables: {
      character_input: removeCharacterPromptSuffix(currentDescription),
      user_input: modifyInstruction,
    },
  })

  await reportTaskProgress(job, 22, {
    stage: 'ai_modify_appearance_prepare',
    stageLabel: '准备角色描述修改参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'ai_modify_appearance_prepare')

  const response = await runShotPromptCompletion({
    job,
    model: projectWorkflow.analysisModel,
    prompt: finalPrompt,
    action: 'ai_modify_appearance',
    streamContextKey: 'ai_modify_appearance',
    streamStepId: 'ai_modify_appearance',
    streamStepTitle: '角色描述修改',
  })
  await assertTaskActive(job, 'ai_modify_appearance_parse')

  const modifiedDescription = readRequiredString(response.data.prompt, 'prompt')

  await reportTaskProgress(job, 96, {
    stage: 'ai_modify_appearance_done',
    stageLabel: '角色描述修改完成',
    displayMode: 'detail',
    meta: { characterId, appearanceId },
  })

  return {
    success: true,
    modifiedDescription,
    originalPrompt: finalPrompt,
    rawResponse: response.text,
  }
}
