import type { Locale } from '@/i18n/routing'
import {
  createPlannedTask,
  type OperationPlan,
} from '@/lib/operations/planning'
import { TASK_TYPE } from '@/lib/task/types'
import { prepareProjectEditStylePreviewCandidates } from './service'

export interface EditStylePreviewPlanMetadata {
  readonly bibleId: string
  readonly stylePreviewIds: readonly string[]
  readonly imageModel: string
  readonly count: number
}

export async function planProjectEditStylePreviews(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly locale: Locale
  readonly bibleId?: string
  readonly styleDirection?: string
  readonly count?: number
}): Promise<OperationPlan> {
  const prepared = await prepareProjectEditStylePreviewCandidates(input)
  const imageModels = new Set(prepared.candidates.map((candidate) => candidate.imageModel))
  if (imageModels.size !== 1) throw new Error('EDIT_STYLE_PREVIEW_PLAN_IMAGE_MODEL_MISMATCH')
  const imageModel = prepared.candidates[0]?.imageModel
  if (!imageModel) throw new Error('EDIT_STYLE_PREVIEW_PLAN_EMPTY')
  const metadata: EditStylePreviewPlanMetadata = {
    bibleId: prepared.bibleId,
    stylePreviewIds: prepared.candidates.map((candidate) => candidate.preview.id),
    imageModel,
    count: prepared.candidates.length,
  }
  return {
    kind: 'task_submission',
    operationId: 'generate_edit_style_previews',
    projectId: input.projectId,
    userId: input.userId,
    summary: 'Generate the planned visual style preview images.',
    metadata: { ...metadata },
    tasks: prepared.candidates.map((candidate) => createPlannedTask({
      id: `edit-style-preview:${candidate.preview.id}`,
      taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      targetType: 'ProjectEditStylePreview',
      targetId: candidate.preview.id,
      payload: candidate.payload,
      billingInfo: candidate.billingInfo,
      locale: input.locale,
      episodeId: input.episodeId,
      dedupeKey: `edit_style_preview_image:${input.projectId}:${input.episodeId}:${candidate.preview.id}`,
    })),
  }
}

export function readEditStylePreviewPlanMetadata(plan: OperationPlan): EditStylePreviewPlanMetadata {
  const metadata = plan.metadata
  const bibleId = typeof metadata?.bibleId === 'string' ? metadata.bibleId.trim() : ''
  const imageModel = typeof metadata?.imageModel === 'string' ? metadata.imageModel.trim() : ''
  const stylePreviewIds = Array.isArray(metadata?.stylePreviewIds)
    ? metadata.stylePreviewIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const count = typeof metadata?.count === 'number' && Number.isInteger(metadata.count) ? metadata.count : 0
  if (!bibleId || !imageModel || count < 1 || stylePreviewIds.length !== count) {
    throw new Error('EDIT_STYLE_PREVIEW_PLAN_METADATA_INVALID')
  }
  return { bibleId, imageModel, stylePreviewIds, count }
}
