import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { ApiError } from '@/lib/api-errors'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import { withTextBilling } from '@/lib/billing'
import { getProjectModelConfig } from '@/lib/config-service'
import {
  assertEpisodeSourceWritable,
  createEpisodeSourceDocument,
  deleteEpisodeSourceDocumentForRollback,
  estimateEditSourceDocumentInputTokens,
  type EditSourceDocumentKind,
} from '@/lib/edit-source-document'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_TYPE } from '@/lib/task/types'
import { EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE } from '@/lib/edit-source-document'
import { prepareEditBibleGenerationTarget } from './service'

type OperationTaskSubmitResult = Awaited<ReturnType<typeof submitOperationTask>>

export type EditBibleGenerationTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly editBibleId: string
  readonly taskType: typeof TASK_TYPE.EDIT_BIBLE_GENERATE
  readonly targetType: 'ProjectEditBible'
  readonly targetId: string
}

async function buildEditBibleTextTaskPayload(input: {
  readonly projectId: string
  readonly userId: string
  readonly estimatedInputTokens: number
  readonly payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const config = await getProjectModelConfig(input.projectId, input.userId)
  if (!config.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for edit bible generation',
    })
  }
  return {
    ...input.payload,
    analysisModel: config.analysisModel,
    maxInputTokens: input.estimatedInputTokens + EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE,
  }
}

async function generateSourceDocumentFromPrompt(input: {
  readonly projectId: string
  readonly userId: string
  readonly locale: Locale
  readonly prompt: string
}): Promise<string> {
  const config = await getProjectModelConfig(input.projectId, input.userId)
  if (!config.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for prompt-to-script source generation',
    })
  }
  const analysisModel = config.analysisModel
  const finalPromptContent = buildAiPromptContent({
    promptId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
    locale: input.locale,
    variables: {
      user_prompt: input.prompt,
    },
  })
  const finalPrompt = flattenChatMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(
    1200,
    estimateEditSourceDocumentInputTokens(finalPrompt) + EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE,
  )
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: analysisModel,
    messages: [{ role: 'user', content: finalPromptContent }],
    temperature: 0.4,
    projectId: input.projectId,
    action: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
    meta: {
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      stepTitle: 'Expand prompt into source script',
      stepIndex: 1,
      stepTotal: 1,
    },
  })
  const result = await withTextBilling(
    input.userId,
    analysisModel,
    maxInputTokens,
    {
      projectId: input.projectId,
      action: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      metadata: { promptId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT },
    },
    runCompletion,
  )
  const text = result.text.trim()
  if (!text) throw new Error('EDIT_BIBLE_PROMPT_SOURCE_GENERATION_EMPTY')
  return text
}

export async function submitProjectEditBibleGenerationTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceKind: EditSourceDocumentKind
  readonly text: string
  readonly rawFileMediaId?: string
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditBibleGenerationTaskSubmitResult> {
  await assertEpisodeSourceWritable({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
  })
  const sourceText = input.sourceKind === 'prompt_generated_outline'
    ? await generateSourceDocumentFromPrompt({
        projectId: input.projectId,
        userId: input.userId,
        locale: input.locale,
        prompt: input.text,
      })
    : input.text
  const sourceDocument = await createEpisodeSourceDocument({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceKind: input.sourceKind,
    text: sourceText,
    ...(input.rawFileMediaId ? { rawFileMediaId: input.rawFileMediaId } : {}),
  })

  let target: Awaited<ReturnType<typeof prepareEditBibleGenerationTarget>> | null = null
  try {
    target = await prepareEditBibleGenerationTarget({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
    })
    const payload = await buildEditBibleTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      estimatedInputTokens: sourceDocument.estimatedInputTokens,
      payload: {
        episodeId: input.episodeId,
        sourceDocumentId: sourceDocument.id,
        editBibleId: target.editBibleId,
        sourceChecksum: sourceDocument.checksum,
        sourceVersion: sourceDocument.version,
        displayMode: 'detail',
      },
    })
    const result = await submitOperationTask({
      request: input.request,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      type: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: target.editBibleId,
      operationId: 'ingest_script',
      source: input.source,
      confirmed: input.confirmed,
      payload,
      dedupeKey: `edit_bible_generate:${input.projectId}:${input.episodeId}:${sourceDocument.checksum}`,
      locale: input.locale,
    })

    return {
      ...result,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
      editBibleId: target.editBibleId,
      taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: target.editBibleId,
    }
  } catch (error) {
    if (target) await target.rollback()
    await deleteEpisodeSourceDocumentForRollback({ sourceDocumentId: sourceDocument.id })
    throw error
  }
}
