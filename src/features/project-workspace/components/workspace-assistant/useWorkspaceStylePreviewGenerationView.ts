'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  buildEditStylePreviewSetView,
  type EditStylePreviewSetView,
} from '@/lib/edit-script/style-preview-set-view'
import { projectEditBibleQueryOptions } from '@/lib/query/hooks'
import {
  useTaskTargetStateMap,
  type TaskTargetStateQuery,
} from '@/lib/query/hooks/useTaskTargetStateMap'
import { TASK_RUNTIME_TARGETS, type TaskRuntimeStateLike } from '@/lib/task/runtime-targets'

export function useWorkspaceStylePreviewGenerationView(params: {
  readonly projectId: string
  readonly episodeId?: string
  readonly enabled: boolean
}): EditStylePreviewSetView | null {
  const editBibleQuery = useQuery({
    ...projectEditBibleQueryOptions(params.projectId, params.episodeId ?? ''),
    enabled: params.enabled && Boolean(params.projectId && params.episodeId),
    select: (response) => response.editBible,
  })
  const previews = useMemo(
    () => editBibleQuery.data?.stylePreviews ?? [],
    [editBibleQuery.data?.stylePreviews],
  )
  const taskTargets = useMemo<TaskTargetStateQuery[]>(() => previews.flatMap((preview) => {
    const target = TASK_RUNTIME_TARGETS.projectEditStylePreviewImage(preview.id)
    return target ? [target] : []
  }), [previews])
  const taskStateQuery = useTaskTargetStateMap(params.projectId, taskTargets, {
    enabled: params.enabled && taskTargets.length > 0,
  })
  const taskStatesByTargetId = useMemo(() => {
    const states = new Map<string, TaskRuntimeStateLike>()
    taskStateQuery.data.forEach((state) => states.set(state.targetId, state))
    return states
  }, [taskStateQuery.data])

  return useMemo(() => buildEditStylePreviewSetView({
    previews,
    taskStatesByTargetId,
  }), [previews, taskStatesByTargetId])
}
