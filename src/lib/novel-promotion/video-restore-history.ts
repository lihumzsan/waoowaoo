import { normalizeVideoModelKey } from '@/lib/novel-promotion/video-model-defaults'

export type VideoGenerationMode = 'normal' | 'firstlastframe' | 'split'

type PanelVideoSnapshot = {
  id: string
  videoUrl: string | null
}

type TaskVideoSnapshot = {
  id: string
  targetId: string
  payload: unknown
  result: unknown
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readTaskVideoUrl(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  return asNonEmptyString((result as Record<string, unknown>).videoUrl)
}

export function readTaskVideoModel(payload: unknown, result?: unknown): string | null {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const modelFromResult = asNonEmptyString((result as Record<string, unknown>).videoModel)
    if (modelFromResult) return normalizeVideoModelKey(modelFromResult)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const payloadRecord = payload as Record<string, unknown>
  const modelFromPayload = asNonEmptyString(payloadRecord.videoModel)
  if (modelFromPayload) return normalizeVideoModelKey(modelFromPayload)

  const firstLastFrame = payloadRecord.firstLastFrame
  if (firstLastFrame && typeof firstLastFrame === 'object' && !Array.isArray(firstLastFrame)) {
    const firstLastModel = asNonEmptyString((firstLastFrame as Record<string, unknown>).flModel)
    return firstLastModel ? normalizeVideoModelKey(firstLastModel) : null
  }

  return null
}

export function readTaskGenerationMode(payload: unknown, result: unknown): VideoGenerationMode {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const raw = (result as Record<string, unknown>).generationMode
    if (raw === 'firstlastframe' || raw === 'normal' || raw === 'split') return raw
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const firstLastFrame = (payload as Record<string, unknown>).firstLastFrame
    if (firstLastFrame && typeof firstLastFrame === 'object' && !Array.isArray(firstLastFrame)) {
      return 'firstlastframe'
    }
  }

  return 'normal'
}

export function findPreviousCompletedVideoTask(
  currentVideoUrl: string | null | undefined,
  tasks: Array<Pick<TaskVideoSnapshot, 'id' | 'payload' | 'result'>>,
) {
  const normalizedCurrentVideoUrl = asNonEmptyString(currentVideoUrl)

  return tasks.find((task) => {
    const taskVideoUrl = readTaskVideoUrl(task.result)
    if (!taskVideoUrl) return false
    if (!normalizedCurrentVideoUrl) return true
    return taskVideoUrl !== normalizedCurrentVideoUrl
  }) || null
}

export function buildPanelPreviousVideoAvailabilityMap(
  panels: PanelVideoSnapshot[],
  tasks: TaskVideoSnapshot[],
) {
  const currentVideoUrls = new Map<string, string | null>(
    panels.map((panel) => [panel.id, asNonEmptyString(panel.videoUrl)]),
  )
  const availability = new Map<string, boolean>(
    panels.map((panel) => [panel.id, false]),
  )

  for (const task of tasks) {
    if (availability.get(task.targetId)) continue

    const taskVideoUrl = readTaskVideoUrl(task.result)
    if (!taskVideoUrl) continue

    const currentVideoUrl = currentVideoUrls.get(task.targetId) ?? null
    if (!currentVideoUrl || taskVideoUrl !== currentVideoUrl) {
      availability.set(task.targetId, true)
    }
  }

  return availability
}
