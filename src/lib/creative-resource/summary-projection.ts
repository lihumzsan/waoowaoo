import type {
  CreativeResourceJsonValue,
  CreativeResourceSummaryView,
  CreativeResourceView,
} from './contracts'
import { getCreativeResourceSchema } from './schema-registry'

const SUMMARY_TEXT_MAX_CHARACTERS = 1_200

function summaryText(value: string | null | undefined): CreativeResourceSummaryView | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (trimmed.length <= SUMMARY_TEXT_MAX_CHARACTERS) {
    return { kind: 'text', text: trimmed }
  }
  return {
    kind: 'text',
    text: `${trimmed.slice(0, SUMMARY_TEXT_MAX_CHARACTERS).trimEnd()}…`,
  }
}

function structuredEntryCount(value: CreativeResourceJsonValue): number | null {
  if (Array.isArray(value)) return value.length
  if (value !== null && typeof value === 'object') return Object.keys(value).length
  return null
}

export function projectCreativeResourceSummary(
  resource: CreativeResourceView,
): CreativeResourceSummaryView {
  const content = resource.materialization?.content
  if (!content) {
    return summaryText(resource.pendingGeneration?.prompt) ?? { kind: 'empty' }
  }
  if (content.kind === 'text') {
    return summaryText(content.text) ?? { kind: 'empty' }
  }
  if (content.kind === 'structured') {
    const schema = getCreativeResourceSchema(resource.schemaId)
    const projected = schema?.structuredSummaryProjector?.(content.data) ?? null
    return summaryText(projected) ?? {
      kind: 'structured',
      entryCount: structuredEntryCount(content.data),
    }
  }
  if (content.kind === 'media') {
    return {
      kind: 'media',
      mediaType: resource.mediaType,
      url: content.url,
      mimeType: content.mimeType,
      width: content.width,
      height: content.height,
      durationMs: content.durationMs,
    }
  }
  return { kind: 'empty' }
}
