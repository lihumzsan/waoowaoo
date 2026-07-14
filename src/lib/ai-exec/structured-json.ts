import { AppError } from '@/lib/errors/app-error'

export type StructuredParseMode =
  | { readonly kind: 'object' }
  | { readonly kind: 'array'; readonly fallbackKey?: string }

export type ParsedStructuredJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: AppError }

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...[truncated]`
}

function unwrapCompleteJsonFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed

  const openingLineEnd = trimmed.indexOf('\n')
  const closingLineStart = trimmed.lastIndexOf('\n')
  if (openingLineEnd < 0 || closingLineStart <= openingLineEnd) return trimmed

  const openingLine = trimmed.slice(0, openingLineEnd).trimEnd()
  const infoString = openingLine.slice(3).trim().toLowerCase()
  if (openingLine.slice(0, 3) !== '```' || (infoString !== '' && infoString !== 'json')) {
    return trimmed
  }

  const closingLine = trimmed.slice(closingLineStart + 1).trim()
  if (closingLine !== '```') return trimmed

  return trimmed.slice(openingLineEnd + 1, closingLineStart).trim()
}

export function parseStructuredJsonByMode(
  text: string,
  mode: StructuredParseMode,
): ParsedStructuredJsonResult {
  const normalizedText = unwrapCompleteJsonFence(text)
  if (!normalizedText) {
    return {
      ok: false,
      error: new AppError('EMPTY_RESPONSE', 'Model returned no structured response body'),
    }
  }

  try {
    const parsed: unknown = JSON.parse(normalizedText)
    if (mode.kind === 'object') {
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, value: parsed }
      }
      return {
        ok: false,
        error: new AppError('PARSE_ERROR', 'Expected JSON object from model output', {
          details: { parseMode: mode.kind, rawTextHead: truncate(text, 1000) },
        }),
      }
    }

    if (Array.isArray(parsed)) {
      return { ok: true, value: parsed }
    }
    if (parsed && typeof parsed === 'object' && mode.fallbackKey) {
      const wrapped = (parsed as Record<string, unknown>)[mode.fallbackKey]
      if (Array.isArray(wrapped)) {
        return { ok: true, value: wrapped }
      }
    }
    return {
      ok: false,
      error: new AppError('PARSE_ERROR', 'Expected JSON array from model output', {
        details: { parseMode: mode.kind, fallbackKey: mode.fallbackKey || null, rawTextHead: truncate(text, 1000) },
      }),
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: new AppError('PARSE_ERROR', error instanceof Error ? error.message : 'Model output could not be parsed', {
        details: {
          parseMode: mode.kind,
          fallbackKey: mode.kind === 'array' ? mode.fallbackKey || null : null,
          rawTextHead: truncate(text, 1000),
        },
        cause: error,
      }),
    }
  }
}
