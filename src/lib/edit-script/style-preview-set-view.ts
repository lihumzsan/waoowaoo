import type { TaskRuntimeStateLike } from '@/lib/task/runtime-targets'
import { isTaskRuntimeRunningPhase } from '@/lib/task/runtime-targets'
import type { ProjectEditStylePreview } from '@/types/project'

export type EditStylePreviewCardStatus = 'loading' | 'generating' | 'completed' | 'failed'

export interface EditStylePreviewCandidateView {
  readonly id: string
  readonly styleKey: ProjectEditStylePreview['styleKey']
  readonly title: string
  readonly summary: string
  readonly aspectRatio: ProjectEditStylePreview['aspectRatio']
  readonly imageUrl: string | null
  readonly errorMessage: string | null
  readonly confirmed: boolean
  readonly status: EditStylePreviewCardStatus
  readonly taskState: TaskRuntimeStateLike | null
}

export interface EditStylePreviewSetView {
  readonly candidates: readonly EditStylePreviewCandidateView[]
  readonly allCandidates: readonly EditStylePreviewCandidateView[]
  readonly hasConfirmedPreview: boolean
  readonly hasGeneratingPreview: boolean
  readonly hasFailedPreview: boolean
}

export function isDisplayableEditStylePreview(preview: ProjectEditStylePreview): boolean {
  return Boolean(preview.taskId)
    || preview.status === 'generating'
    || preview.status === 'completed'
    || preview.status === 'confirmed'
    || preview.status === 'failed'
}

export function resolveEditStylePreviewCardStatus(params: {
  readonly preview: ProjectEditStylePreview | null
  readonly taskState: TaskRuntimeStateLike | null | undefined
}): EditStylePreviewCardStatus {
  if (
    params.preview?.status === 'failed'
    || params.taskState?.phase === 'failed'
    || params.taskState?.phase === 'canceled'
  ) return 'failed'
  if (
    params.preview?.imageUrl
    && (params.preview.status === 'completed' || params.preview.status === 'confirmed')
  ) {
    return 'completed'
  }
  if (isTaskRuntimeRunningPhase(params.taskState?.phase)) return 'generating'
  if (params.preview) return 'generating'
  return 'loading'
}

export function buildEditStylePreviewSetView(params: {
  readonly previews: readonly ProjectEditStylePreview[]
  readonly taskStatesByTargetId?: ReadonlyMap<string, TaskRuntimeStateLike>
}): EditStylePreviewSetView | null {
  const previews = params.previews.filter(isDisplayableEditStylePreview)
  if (previews.length === 0) return null

  const allCandidates = previews.map((preview): EditStylePreviewCandidateView => {
    const taskState = params.taskStatesByTargetId?.get(preview.id) ?? null
    return {
      id: preview.id,
      styleKey: preview.styleKey,
      title: preview.title,
      summary: preview.summary,
      aspectRatio: preview.aspectRatio,
      imageUrl: preview.imageUrl,
      errorMessage: preview.errorMessage ?? taskState?.lastError?.message ?? null,
      confirmed: preview.status === 'confirmed',
      status: resolveEditStylePreviewCardStatus({ preview, taskState }),
      taskState,
    }
  })
  const confirmedCandidate = allCandidates.find((candidate) => candidate.confirmed) ?? null
  const candidates = confirmedCandidate ? [confirmedCandidate] : allCandidates

  return {
    candidates,
    allCandidates,
    hasConfirmedPreview: Boolean(confirmedCandidate),
    hasGeneratingPreview: candidates.some((candidate) => candidate.status === 'generating'),
    hasFailedPreview: candidates.some((candidate) => candidate.status === 'failed'),
  }
}
