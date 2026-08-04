import type { UnifiedModelType } from '@/lib/ai-registry/types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getProviderKey(providerId: string): string {
  const index = providerId.indexOf(':')
  return index === -1 ? providerId : providerId.slice(0, index)
}

export function isUnifiedModelType(value: unknown): value is UnifiedModelType {
  return (
    value === 'llm'
    || value === 'image'
    || value === 'video'
    || value === 'music'
    || value === 'voice'
  )
}
