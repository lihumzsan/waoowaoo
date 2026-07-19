import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker'
import {
  buildEditSourceBlocks,
  createEpisodeSourceDocument,
  readEpisodeSourceDocumentById,
  type EditSourceDocumentKind,
} from '@/lib/edit-source-document'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { EDIT_BIBLE_STATUS } from './constraints'
import { validateEditBibleBundle } from './cross-check'
import type { EditBibleBundle, RawEditBibleBundle } from './schemas'
import {
  normalizeRawBeatSheet,
  normalizeRawEditBible,
  normalizeRawEmotionalCurve,
  normalizeRawLedger,
} from './source-anchor-normalization'
import {
  persistGeneratedEditBibleBundle,
  prepareEditBibleGenerationTarget,
  readEpisodeEditBible,
  readEpisodeEditChapters,
} from './service'

export const CREATIVE_EDIT_BIBLE_ADOPTION_ERROR_CODES = [
  'CREATIVE_EDIT_BIBLE_BUNDLE_INVALID',
  'CREATIVE_EDIT_BIBLE_TASK_NOT_ADOPTABLE',
  'CREATIVE_EDIT_BIBLE_TASK_PAYLOAD_INVALID',
  'CREATIVE_EDIT_BIBLE_TASK_RESULT_INVALID',
  'CREATIVE_EDIT_BIBLE_TASK_OUTPUT_KIND_INVALID',
  'CREATIVE_EDIT_BIBLE_SOURCE_PROVENANCE_REQUIRED',
  'CREATIVE_EDIT_BIBLE_SOURCE_REVISION_MISMATCH',
  'CREATIVE_EDIT_BIBLE_ADOPTION_STATE_INVALID',
  'CREATIVE_EDIT_BIBLE_TASK_OWNERSHIP_CAS_FAILED',
] as const

export type CreativeEditBibleAdoptionErrorCode =
  (typeof CREATIVE_EDIT_BIBLE_ADOPTION_ERROR_CODES)[number]

function failAdoption(
  code: CreativeEditBibleAdoptionErrorCode,
  details: Record<string, unknown> = {},
): never {
  throw new ApiError('INVALID_PARAMS', { code, ...details })
}

function normalizeCreativeBundle(input: {
  readonly rawBundle: RawEditBibleBundle
  readonly sourceText: string
}): EditBibleBundle {
  try {
    const blocks = buildEditSourceBlocks(input.sourceText)
    const bible = normalizeRawEditBible({ raw: input.rawBundle.bible })
    const beatSheet = normalizeRawBeatSheet({
      raw: input.rawBundle.beatSheet,
      sourceText: input.sourceText,
      blocks,
    })
    const ledger = normalizeRawLedger({
      raw: input.rawBundle.ledger,
      beatSheet,
    })
    const emotionalCurve = normalizeRawEmotionalCurve({
      raw: input.rawBundle.emotionalCurve,
      sourceText: input.sourceText,
      blocks,
    })
    return validateEditBibleBundle({
      bundle: { bible, beatSheet, ledger, emotionalCurve },
      sourceText: input.sourceText,
    })
  } catch (error: unknown) {
    failAdoption('CREATIVE_EDIT_BIBLE_BUNDLE_INVALID', {
      validationError: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function saveCreativeEditSource(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceKind: Extract<EditSourceDocumentKind, 'upload' | 'paste'>
  readonly text: string
  readonly rawFileMediaId?: string
  readonly client: Prisma.TransactionClient
}) {
  return await createEpisodeSourceDocument({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceKind: input.sourceKind,
    text: input.text,
    ...(input.rawFileMediaId ? { rawFileMediaId: input.rawFileMediaId } : {}),
    client: input.client,
  })
}

export async function adoptCreativeEditBibleBundle(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly taskId: string
  readonly client: Prisma.TransactionClient
}) {
  const task = await input.client.task.findFirst({
    where: {
      id: input.taskId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      type: TASK_TYPE.CREATIVE_WORK,
      status: TASK_STATUS.COMPLETED,
    },
    select: {
      id: true,
      payload: true,
      result: true,
    },
  })
  if (!task) failAdoption('CREATIVE_EDIT_BIBLE_TASK_NOT_ADOPTABLE')

  const parsedPayload = creativeWorkTaskPayloadSchema.safeParse(task.payload)
  if (!parsedPayload.success) {
    failAdoption('CREATIVE_EDIT_BIBLE_TASK_PAYLOAD_INVALID', {
      issues: parsedPayload.error.issues,
    })
  }
  const parsedResult = creativeWorkTaskResultSchema.safeParse(task.result)
  if (!parsedResult.success) {
    failAdoption('CREATIVE_EDIT_BIBLE_TASK_RESULT_INVALID', {
      issues: parsedResult.error.issues,
    })
  }
  const payload = parsedPayload.data
  const result = parsedResult.data
  if (
    result.requestKey !== payload.requestKey
    || result.continuationProjection.requestKey !== payload.requestKey
    || result.lifecycleProjection.requestKey !== payload.requestKey
    || payload.request.outputKind !== 'edit_bible_bundle'
    || result.outputKind !== 'edit_bible_bundle'
    || result.creativeWorkResult.outputKind !== 'edit_bible_bundle'
    || result.creativeWorkResult.output.kind !== 'edit_bible_bundle'
  ) {
    failAdoption('CREATIVE_EDIT_BIBLE_TASK_OUTPUT_KIND_INVALID')
  }

  const sourceDocument = await readEpisodeSourceDocumentById({
    projectId: input.projectId,
    episodeId: input.episodeId,
    sourceDocumentId: input.sourceDocumentId,
    client: input.client,
  })
  const sourceMaterials = payload.request.context.sourceMaterials.filter((material) => (
    material.provenance.kind === 'domain'
    && material.provenance.sourceType === 'edit_source_document'
    && material.provenance.sourceId === sourceDocument.id
  ))
  if (sourceMaterials.length !== 1) {
    failAdoption('CREATIVE_EDIT_BIBLE_SOURCE_PROVENANCE_REQUIRED', {
      matchingSourceMaterialCount: sourceMaterials.length,
    })
  }
  const sourceMaterial = sourceMaterials[0]
  if (!sourceMaterial || sourceMaterial.provenance.kind !== 'domain') {
    failAdoption('CREATIVE_EDIT_BIBLE_SOURCE_PROVENANCE_REQUIRED')
  }
  if (
    sourceMaterial.kind !== 'text'
    || sourceMaterial.provenance.revision !== String(sourceDocument.version)
    || sourceMaterial.provenance.fingerprint !== sourceDocument.checksum
    || sourceMaterial.content !== sourceDocument.normalizedText
  ) {
    failAdoption('CREATIVE_EDIT_BIBLE_SOURCE_REVISION_MISMATCH', {
      sourceDocumentId: sourceDocument.id,
    })
  }

  const existingAdoption = await input.client.projectEditBible.findFirst({
    where: {
      episodeId: input.episodeId,
      sourceDocumentId: input.sourceDocumentId,
      generationTaskId: task.id,
      status: { in: [EDIT_BIBLE_STATUS.READY_FOR_REVIEW, EDIT_BIBLE_STATUS.CONFIRMED] },
    },
    select: { id: true },
  })
  if (existingAdoption) {
    const [editBible, chapters] = await Promise.all([
      readEpisodeEditBible({
        projectId: input.projectId,
        episodeId: input.episodeId,
        client: input.client,
      }),
      readEpisodeEditChapters({
        projectId: input.projectId,
        episodeId: input.episodeId,
        client: input.client,
      }),
    ])
    if (!editBible || editBible.id !== existingAdoption.id || chapters.length === 0) {
      failAdoption('CREATIVE_EDIT_BIBLE_ADOPTION_STATE_INVALID', { taskId: task.id })
    }
    return { editBible, chapters }
  }

  const bundle = normalizeCreativeBundle({
    rawBundle: result.creativeWorkResult.output.bundle,
    sourceText: sourceDocument.normalizedText,
  })
  const target = await prepareEditBibleGenerationTarget({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceDocumentId: input.sourceDocumentId,
    client: input.client,
  })
  const owned = await input.client.projectEditBible.updateMany({
    where: {
      id: target.editBibleId,
      episodeId: input.episodeId,
      sourceDocumentId: input.sourceDocumentId,
      version: target.version,
      status: EDIT_BIBLE_STATUS.GENERATING,
      generationTaskId: null,
    },
    data: { generationTaskId: task.id },
  })
  if (owned.count !== 1) {
    failAdoption('CREATIVE_EDIT_BIBLE_TASK_OWNERSHIP_CAS_FAILED', {
      editBibleId: target.editBibleId,
      taskId: task.id,
    })
  }

  return await persistGeneratedEditBibleBundle({
    projectId: input.projectId,
    episodeId: input.episodeId,
    editBibleId: target.editBibleId,
    sourceDocumentId: input.sourceDocumentId,
    taskId: task.id,
    bundle,
    client: input.client,
  })
}
