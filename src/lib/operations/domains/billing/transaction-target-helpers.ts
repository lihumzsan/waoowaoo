export type BillingTransactionTargetLabelParams = Record<string, string | number | Date>

export type BillingTransactionTargetView = {
  targetType: string
  targetId: string
  labelKey: string
  labelParams: BillingTransactionTargetLabelParams
}

export type BillingTransactionTaskContext = {
  id: string
  targetType: string
  targetId: string
}

type TargetRef = {
  taskId: string
  targetType: string
  targetId: string
}

export function toTargetKey(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`
}

export function groupTargetRefs(tasks: BillingTransactionTaskContext[]) {
  const refsByKey = new Map<string, TargetRef[]>()
  const idsByType = new Map<string, Set<string>>()

  for (const task of tasks) {
    if (!task.targetType || !task.targetId) continue
    const ref = {
      taskId: task.id,
      targetType: task.targetType,
      targetId: task.targetId,
    }
    const key = toTargetKey(task.targetType, task.targetId)
    const existingRefs = refsByKey.get(key) ?? []
    existingRefs.push(ref)
    refsByKey.set(key, existingRefs)

    const ids = idsByType.get(task.targetType) ?? new Set<string>()
    ids.add(task.targetId)
    idsByType.set(task.targetType, ids)
  }

  return { refsByKey, idsByType }
}

export function idsFor(idsByType: Map<string, Set<string>>, targetType: string): string[] {
  return [...(idsByType.get(targetType) ?? new Set<string>())]
}

export function assignTargetView(
  result: Map<string, BillingTransactionTargetView>,
  refsByKey: Map<string, TargetRef[]>,
  view: BillingTransactionTargetView,
) {
  const refs = refsByKey.get(toTargetKey(view.targetType, view.targetId)) ?? []
  for (const ref of refs) {
    result.set(ref.taskId, view)
  }
}

function readShotNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
}

export function formatShotNumbers(value: unknown): string {
  const numbers = readShotNumbers(value)
  if (numbers.length === 0) return ''
  if (numbers.length <= 4) return numbers.join(', ')
  return `${numbers.slice(0, 4).join(', ')}...`
}

export function formatShotIds(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const shotIds = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
  if (shotIds.length === 0) return ''
  if (shotIds.length <= 4) return shotIds.join(', ')
  return `${shotIds.slice(0, 4).join(', ')}...`
}
