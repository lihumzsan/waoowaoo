import type { Job } from 'bullmq'
import { removePropPromptSuffix } from '@/lib/constants'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskJobData } from '@/lib/task/types'
import { resolveAnalysisModel } from './shot-ai-persist'
import { runShotPromptCompletion } from './shot-ai-prompt-runtime'
import { readRequiredString, type AnyObj } from './shot-ai-prompt-utils'
import { buildAiPrompt as buildPrompt, AI_PROMPT_IDS as PROMPT_IDS } from '@/lib/ai-prompts'

export async function handleModifyPropTask(job: Job<TaskJobData>, payload: AnyObj) {
  const propId = readRequiredString(payload.propId, 'propId')
  const variantId = typeof payload.variantId === 'string' ? payload.variantId.trim() : ''
  const propName = typeof payload.propName === 'string' && payload.propName.trim() ? payload.propName.trim() : '道具'
  const currentDescription = readRequiredString(payload.currentDescription, 'currentDescription')
  const modifyInstruction = readRequiredString(payload.modifyInstruction, 'modifyInstruction')
  const projectWorkflow = await resolveAnalysisModel(job.data.projectId, job.data.userId)

  const finalPrompt = buildPrompt({
    promptId: PROMPT_IDS.PROP_UPDATE_DESCRIPTION,
    locale: job.data.locale,
    variables: {
      prop_name: propName,
      original_description: removePropPromptSuffix(currentDescription),
      modify_instruction: modifyInstruction,
      image_context: '',
    },
  })

  await reportTaskProgress(job, 22, {
    stage: 'ai_modify_prop_prepare',
    stageLabel: '准备道具描述修改参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'ai_modify_prop_prepare')

  const response = await runShotPromptCompletion({
    job,
    model: projectWorkflow.analysisModel,
    prompt: finalPrompt,
    action: 'ai_modify_prop',
    streamContextKey: 'ai_modify_prop',
    streamStepId: 'ai_modify_prop',
    streamStepTitle: '道具描述修改',
  })
  await assertTaskActive(job, 'ai_modify_prop_parse')

  const prompt = readRequiredString(response.data.prompt, 'prompt')
  const modifiedDescription = removePropPromptSuffix(prompt)

  await reportTaskProgress(job, 96, {
    stage: 'ai_modify_prop_done',
    stageLabel: '道具描述修改完成',
    displayMode: 'detail',
    meta: { propId, variantId: variantId || null },
  })

  return {
    success: true,
    modifiedDescription,
    originalPrompt: finalPrompt,
    rawResponse: response.text,
  }
}
