import type { TaskBillingInfo, TaskType } from '@/lib/task/types'

export function isBillableTaskType(_taskType: TaskType) {
  void _taskType
  return false
}

export function buildDefaultTaskBillingInfo(
  _taskType: TaskType,
  _payload: Record<string, unknown> | null | undefined,
): TaskBillingInfo | null {
  void _taskType
  void _payload
  return null
}
