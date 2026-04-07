export type LocationAvailableSlot = string
export type LocationSlotLocale = 'zh' | 'en'

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeLocationAvailableSlots(value: unknown): LocationAvailableSlot[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const slots: LocationAvailableSlot[] = []

  for (const item of value) {
    const normalized = normalizeText(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    slots.push(normalized)
  }

  return slots
}

export function parseLocationAvailableSlots(raw: string | null | undefined): LocationAvailableSlot[] {
  if (!raw) return []
  try {
    return normalizeLocationAvailableSlots(JSON.parse(raw))
  } catch {
    return []
  }
}

export function stringifyLocationAvailableSlots(slots: LocationAvailableSlot[]): string {
  return JSON.stringify(normalizeLocationAvailableSlots(slots))
}

export function formatLocationAvailableSlotsText(
  slots: LocationAvailableSlot[],
  locale: LocationSlotLocale = 'zh',
): string {
  const normalized = normalizeLocationAvailableSlots(slots)
  if (normalized.length === 0) return ''
  const lines = normalized.map((slot) => `- ${slot}`)
  const header = locale === 'en' ? 'Available character slots:' : '可站位置：'
  return `${header}\n${lines.join('\n')}`
}
