import { createHash, randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveLocaleFromContext(locale?: unknown): string {
  const normalized = normalizeString(locale)
  return normalized || 'zh'
}

export function resolveCandidateCount(input?: unknown): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(4, Math.trunc(parsed)))
}

export function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input
    .map((item) => normalizeString(item))
    .filter(Boolean)))
}

export type ReferenceImageNoteInput = {
  source: string
  label: string
  instruction: string
  url?: string
  referencePanelId?: string
}

export function normalizeReferenceImageNotes(input: unknown): ReferenceImageNoteInput[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (!isRecord(item)) return null
      const source = normalizeString(item.source) || 'custom'
      const label = normalizeString(item.label)
      const instruction = normalizeString(item.instruction)
      const url = normalizeString(item.url)
      const referencePanelId = normalizeString(item.referencePanelId)
      if (!label && !instruction && !url && !referencePanelId) return null
      return {
        source,
        label,
        instruction,
        ...(url ? { url } : {}),
        ...(referencePanelId ? { referencePanelId } : {}),
      }
    })
    .filter((item): item is ReferenceImageNoteInput => Boolean(item))
    .slice(0, 16)
}

export function formatReferenceImageNote(note: ReferenceImageNoteInput | undefined, fallback: string): string {
  if (!note) return fallback
  const parts = [
    note.source ? `source=${note.source}` : '',
    note.label ? `label=${note.label}` : '',
    note.instruction ? `usage=${note.instruction}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('; ') : fallback
}

export function createReferenceSignature(input: unknown): string {
  const serialized = JSON.stringify(input)
  return createHash('sha1').update(serialized).digest('hex').slice(0, 12)
}

export function createTaskDedupeKey(prefix: string, input: unknown): string {
  const serialized = JSON.stringify(input)
  const digest = createHash('sha1').update(serialized).digest('hex').slice(0, 32)
  return `${prefix}:${digest}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function assertNoLegacyArtStyle(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

export function createPanelVariantId(): string {
  try {
    return randomUUID()
  } catch {
    return `panel-variant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export async function rollbackCreatedVariantPanel(params: {
  panelId: string
  storyboardId: string
  panelIndex: number
}) {
  await prisma.$transaction(async (tx) => {
    await tx.projectPanel.delete({
      where: { id: params.panelId },
    })

    const maxPanel = await tx.projectPanel.findFirst({
      where: { storyboardId: params.storyboardId },
      orderBy: { panelIndex: 'desc' },
      select: { panelIndex: true },
    })
    const maxPanelIndex = maxPanel?.panelIndex ?? -1
    const offset = maxPanelIndex + 1000

    await tx.projectPanel.updateMany({
      where: {
        storyboardId: params.storyboardId,
        panelIndex: { gt: params.panelIndex },
      },
      data: {
        panelIndex: { increment: offset },
        panelNumber: { increment: offset },
      },
    })

    await tx.projectPanel.updateMany({
      where: {
        storyboardId: params.storyboardId,
        panelIndex: { gt: params.panelIndex + offset },
      },
      data: {
        panelIndex: { decrement: offset + 1 },
        panelNumber: { decrement: offset + 1 },
      },
    })

    const panelCount = await tx.projectPanel.count({
      where: { storyboardId: params.storyboardId },
    })

    await tx.projectStoryboard.update({
      where: { id: params.storyboardId },
      data: { panelCount },
    })
  })
}
