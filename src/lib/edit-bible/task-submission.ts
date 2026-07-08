import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { ApiError } from '@/lib/api-errors'
import { getProjectModelConfig } from '@/lib/config-service'
import {
  assertEpisodeSourceWritable,
  createEpisodeSourceDocument,
  deleteEpisodeSourceDocumentForRollback,
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
  const sourceDocument = await createEpisodeSourceDocument({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceKind: input.sourceKind,
    text: input.text,
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
        sourceKind: input.sourceKind,
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
