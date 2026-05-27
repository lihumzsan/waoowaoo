import { isRemovedLegacyLtx23WorkflowKey } from '@/lib/providers/comfyui/ltx23-legacy'

export type JsonCleanupResult = {
  changed: boolean
  value: string | null
  removed: number
}

type StoredModelLike = {
  modelId?: unknown
  modelKey?: unknown
  provider?: unknown
}

type LegacyTaskLike = {
  targetId?: unknown
  payload?: unknown
  result?: unknown
  billingInfo?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function readStoredModelKey(model: StoredModelLike): string {
  if (typeof model.modelKey === 'string' && model.modelKey.trim()) return model.modelKey.trim()
  if (
    typeof model.provider === 'string'
    && model.provider.trim()
    && typeof model.modelId === 'string'
    && model.modelId.trim()
  ) {
    return `${model.provider.trim()}::${model.modelId.trim()}`
  }
  return ''
}

export function isLegacyPayload(value: unknown): boolean {
  const stack: unknown[] = [value]
  const seen = new Set<object>()

  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current === 'string' && isRemovedLegacyLtx23WorkflowKey(current)) return true
    if (!current || typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)

    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }

    stack.push(...Object.values(current as Record<string, unknown>))
  }

  return false
}

export function taskReferencesLegacyLtx23(task: LegacyTaskLike): boolean {
  return isLegacyPayload(task.payload)
    || isLegacyPayload(task.result)
    || isLegacyPayload(task.billingInfo)
}

export function collectLegacyPanelIdsToClear(
  legacyProjectPanelIds: string[],
  tasks: LegacyTaskLike[],
): string[] {
  const panelIds = new Set<string>()
  for (const panelId of legacyProjectPanelIds) {
    if (panelId) panelIds.add(panelId)
  }
  for (const task of tasks) {
    if (!taskReferencesLegacyLtx23(task)) continue
    if (typeof task.targetId === 'string' && task.targetId.trim()) {
      panelIds.add(task.targetId.trim())
    }
  }
  return Array.from(panelIds)
}

export function removeLegacyCustomModels(raw: string | null | undefined): JsonCleanupResult {
  if (!raw) return { changed: false, value: raw ?? null, removed: 0 }
  const parsed = parseJson(raw)
  if (!Array.isArray(parsed)) return { changed: false, value: raw, removed: 0 }

  const kept = parsed.filter((item) => {
    if (!isRecord(item)) return true
    return !isRemovedLegacyLtx23WorkflowKey(readStoredModelKey(item))
  })

  return {
    changed: kept.length !== parsed.length,
    value: JSON.stringify(kept),
    removed: parsed.length - kept.length,
  }
}

export function removeLegacyCapabilitySelections(raw: string | null | undefined): JsonCleanupResult {
  if (!raw) return { changed: false, value: raw ?? null, removed: 0 }
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) return { changed: false, value: raw, removed: 0 }

  const next: Record<string, unknown> = {}
  let removed = 0
  for (const [modelKey, selections] of Object.entries(parsed)) {
    if (isRemovedLegacyLtx23WorkflowKey(modelKey)) {
      removed += 1
      continue
    }
    next[modelKey] = selections
  }

  return {
    changed: removed > 0,
    value: JSON.stringify(next),
    removed,
  }
}
