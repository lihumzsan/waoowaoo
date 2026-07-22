function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function readIndexedDescription(params: {
  descriptions: string | null | undefined
  fallbackDescription: string | null | undefined
  index: number
}): string {
  const list = parseJsonStringArray(params.descriptions).map((item) => item.trim()).filter(Boolean)
  const fallback = trimText(params.fallbackDescription)
  if (typeof list[params.index] === 'string' && list[params.index]) {
    return list[params.index]
  }
  if (typeof list[0] === 'string' && list[0]) {
    return list[0]
  }
  return fallback
}

export function buildCharacterDescriptionFields(params: {
  descriptions: string | null | undefined
  fallbackDescription: string | null | undefined
  index: number
  nextDescription: string
}): { description: string; descriptions: string } {
  const nextDescription = trimText(params.nextDescription)
  const list = parseJsonStringArray(params.descriptions).map((item) => item.trim()).filter(Boolean)
  const fallback = trimText(params.fallbackDescription) || nextDescription
  const nextLength = Math.max(list.length, params.index + 1, 1)
  const values = Array.from({ length: nextLength }, (_, index) => list[index] || list[0] || fallback)
  values[params.index] = nextDescription
  if (!values[0]) {
    values[0] = nextDescription
  }
  return {
    description: values[0],
    descriptions: JSON.stringify(values),
  }
}
