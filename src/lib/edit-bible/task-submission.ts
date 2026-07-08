import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { ApiError } from '@/lib/api-errors'
import { getProjectModelConfig } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import {
  assertEpisodeSourceWritable,
  createEpisodeSourceDocument,
  deleteEpisodeSourceDocumentForRollback,
  estimateEditSourceDocumentInputTokens,
  readEpisodeSourceDocumentById,
  type EditSourceDocumentKind,
} from '@/lib/edit-source-document'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_TYPE } from '@/lib/task/types'
import { EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE } from '@/lib/edit-source-document'
import { prepareEditBibleGenerationTarget } from './service'
import { EDIT_BIBLE_STATUS } from './constraints'

type OperationTaskSubmitResult = Awaited<ReturnType<typeof submitOperationTask>>

export type EditBibleGenerationTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly editBibleId: string
  readonly taskType: typeof TASK_TYPE.EDIT_BIBLE_GENERATE
  readonly targetType: 'ProjectEditBible'
  readonly targetId: string
}

type PreparedEditBibleGenerationTarget = Awaited<ReturnType<typeof prepareEditBibleGenerationTarget>>

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

async function submitPreparedEditBibleGenerationTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly editBibleId: string
  readonly sourceChecksum: string
  readonly sourceVersion: number
  readonly sourceKind: EditSourceDocumentKind
  readonly estimatedInputTokens: number
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
  readonly operationId: string
  readonly previousSourceDocumentId?: string | null
}): Promise<EditBibleGenerationTaskSubmitResult> {
  const payload = await buildEditBibleTextTaskPayload({
    projectId: input.projectId,
    userId: input.userId,
    estimatedInputTokens: input.estimatedInputTokens,
    payload: {
      episodeId: input.episodeId,
      sourceDocumentId: input.sourceDocumentId,
      editBibleId: input.editBibleId,
      sourceChecksum: input.sourceChecksum,
      sourceVersion: input.sourceVersion,
      sourceKind: input.sourceKind,
      ...(input.previousSourceDocumentId ? { previousSourceDocumentId: input.previousSourceDocumentId } : {}),
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
    targetId: input.editBibleId,
    operationId: input.operationId,
    source: input.source,
    confirmed: input.confirmed,
    payload,
    dedupeKey: `edit_bible_generate:${input.projectId}:${input.episodeId}:${input.sourceChecksum}:${input.operationId}`,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: input.episodeId,
    sourceDocumentId: input.sourceDocumentId,
    editBibleId: input.editBibleId,
    taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
    targetType: 'ProjectEditBible',
    targetId: input.editBibleId,
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

  let target: PreparedEditBibleGenerationTarget | null = null
  try {
    target = await prepareEditBibleGenerationTarget({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
    })
    return await submitPreparedEditBibleGenerationTask({
      request: input.request,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
      editBibleId: target.editBibleId,
      sourceChecksum: sourceDocument.checksum,
      sourceVersion: sourceDocument.version,
      sourceKind: input.sourceKind,
      estimatedInputTokens: sourceDocument.estimatedInputTokens,
      source: input.source,
      confirmed: input.confirmed,
      locale: input.locale,
      operationId: 'ingest_script',
    })
  } catch (error) {
    if (target) await target.rollback()
    await deleteEpisodeSourceDocumentForRollback({ sourceDocumentId: sourceDocument.id })
    throw error
  }
}

export async function submitApprovedScriptEditBibleGenerationTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditBibleGenerationTaskSubmitResult> {
  const bible = await prisma.projectEditBible.findFirst({
    where: {
      episodeId: input.episodeId,
      episode: {
        projectId: input.projectId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      sourceDocumentId: true,
      status: true,
    },
  })
  if (!bible) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_REQUIRED_FOR_SCRIPT_APPROVAL',
      message: 'Expanded script is required before generating the episode plan.',
    })
  }
  if (bible.status !== EDIT_BIBLE_STATUS.SCRIPT_APPROVED) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_REVIEW_NOT_READY',
      message: `Expanded script can only generate the episode plan after script approval; current status is ${bible.status}.`,
    })
  }
  const sourceDocument = await readEpisodeSourceDocumentById({
    projectId: input.projectId,
    episodeId: input.episodeId,
    sourceDocumentId: bible.sourceDocumentId,
  })
  if (sourceDocument.sourceKind !== 'prompt_generated_script') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_REVIEW_SOURCE_NOT_MATERIALIZED',
      message: 'Expanded script source document must be materialized before episode-plan generation.',
    })
  }

  let target: PreparedEditBibleGenerationTarget | null = null
  try {
    target = await prepareEditBibleGenerationTarget({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
    })
    return await submitPreparedEditBibleGenerationTask({
      request: input.request,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
      editBibleId: target.editBibleId,
      sourceChecksum: sourceDocument.checksum,
      sourceVersion: sourceDocument.version,
      sourceKind: sourceDocument.sourceKind,
      estimatedInputTokens: estimateEditSourceDocumentInputTokens(sourceDocument.normalizedText),
      source: input.source,
      confirmed: input.confirmed,
      locale: input.locale,
      operationId: 'generate_bible_from_script',
    })
  } catch (error) {
    if (target) await target.rollback()
    throw error
  }
}

export async function submitProjectEditScriptRevisionTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly revisionNotes: string
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditBibleGenerationTaskSubmitResult> {
  const existing = await prisma.projectEditBible.findFirst({
    where: {
      episodeId: input.episodeId,
      episode: {
        projectId: input.projectId,
        project: { userId: input.userId },
      },
    },
    select: {
      sourceDocumentId: true,
      status: true,
    },
  })
  if (!existing) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_REVISION_REQUIRES_SCRIPT',
      message: 'Expanded script is required before script revision.',
    })
  }
  if (existing.status !== EDIT_BIBLE_STATUS.SCRIPT_READY_FOR_REVIEW) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_REVISION_NOT_ALLOWED',
      message: `Expanded script can only be revised from script_ready_for_review; current status is ${existing.status}.`,
    })
  }
  await assertEpisodeSourceWritable({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
  })
  const sourceDocument = await createEpisodeSourceDocument({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceKind: 'prompt_generated_outline',
    text: input.revisionNotes,
  })

  let target: PreparedEditBibleGenerationTarget | null = null
  try {
    target = await prepareEditBibleGenerationTarget({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
    })
    return await submitPreparedEditBibleGenerationTask({
      request: input.request,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
      editBibleId: target.editBibleId,
      sourceChecksum: sourceDocument.checksum,
      sourceVersion: sourceDocument.version,
      sourceKind: sourceDocument.sourceKind,
      estimatedInputTokens: sourceDocument.estimatedInputTokens,
      source: input.source,
      confirmed: input.confirmed,
      locale: input.locale,
      operationId: 'revise_script',
      previousSourceDocumentId: existing.sourceDocumentId,
    })
  } catch (error) {
    if (target) await target.rollback()
    await deleteEpisodeSourceDocumentForRollback({ sourceDocumentId: sourceDocument.id })
    throw error
  }
}
