'use client'

import { useCallback, useMemo } from 'react'
import { useTaskList, type TaskItem } from '@/lib/query/hooks/useTaskStatus'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { useDismissFailedTasks } from '@/lib/query/mutations/task-mutations'

interface UseStoryboardGroupTaskErrorsParams {
  projectId: string
  episodeId: string
  panelOutputById?: Map<string, PanelOutputState>
}

type PanelOutputState = {
  imageUrl?: string | null
  updatedAt?: string | null
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function isStaleFailedImageTask(task: TaskItem, panelOutput: PanelOutputState | undefined): boolean {
  if (!panelOutput?.imageUrl) return false
  const taskUpdatedAt = parseTimestamp(task.updatedAt)
  const panelUpdatedAt = parseTimestamp(panelOutput.updatedAt)
  if (taskUpdatedAt === null || panelUpdatedAt === null) return false
  return panelUpdatedAt > taskUpdatedAt
}

export function buildPanelTaskErrorMap(
  tasks: TaskItem[],
  panelOutputById: Map<string, PanelOutputState> = new Map(),
) {
  const map = new Map<string, { taskId: string; message: string }>()
  for (const task of tasks) {
    if (isStaleFailedImageTask(task, panelOutputById.get(task.targetId))) continue
    const display = resolveErrorDisplay(task.error || null)
    if (!display) continue
    if (!map.has(task.targetId)) {
      map.set(task.targetId, { taskId: task.id, message: display.message })
    }
  }
  return map
}

/**
 * 从数据库查询 panel 级别的 failed tasks，并提供 dismiss 能力。
 * dismiss 通过 API 将 task 状态改为 'dismissed'，数据库为唯一来源。
 */
export function useStoryboardGroupTaskErrors({
  projectId,
  panelOutputById,
}: UseStoryboardGroupTaskErrorsParams) {
  const panelFailedTasksQuery = useTaskList({
    projectId,
    targetType: 'NovelPromotionPanel',
    statuses: ['failed'],
    limit: 200,
    enabled: !!projectId,
  })

  const dismissMutation = useDismissFailedTasks(projectId)

  const panelTaskErrorMap = useMemo(() => {
    return buildPanelTaskErrorMap(panelFailedTasksQuery.data || [], panelOutputById)
  }, [panelFailedTasksQuery.data, panelOutputById])

  const clearPanelTaskError = useCallback((panelId: string) => {
    const taskIds = (panelFailedTasksQuery.data || [])
      .filter((task) => task.targetId === panelId)
      .map((task) => task.id)
    if (taskIds.length === 0) return
    dismissMutation.mutate(taskIds)
  }, [dismissMutation, panelFailedTasksQuery.data])

  return {
    panelTaskErrorMap,
    clearPanelTaskError,
  }
}
