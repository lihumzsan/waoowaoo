import { removePropPromptSuffix } from '@/lib/constants'

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizePropVisualDescription(description: string | null | undefined): string {
  return removePropPromptSuffix(normalizeText(description))
}

export function resolvePropVisualDescription(input: {
  name: string
  summary?: string | null
  description?: string | null
}): string {
  const explicitDescription = normalizePropVisualDescription(input.description)
  if (explicitDescription) {
    return explicitDescription
  }

  const summaryDescription = normalizePropVisualDescription(input.summary)
  if (summaryDescription) {
    return summaryDescription
  }

  return normalizeText(input.name)
}
