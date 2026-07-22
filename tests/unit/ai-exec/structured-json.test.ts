import { describe, expect, it } from 'vitest'
import { parseStructuredJsonByMode } from '@/lib/ai-exec/structured-json'

function expectParseError(input: string): void {
  const result = parseStructuredJsonByMode(input, { kind: 'object' })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe('PARSE_ERROR')
}

describe('parseStructuredJsonByMode', () => {
  it('accepts plain JSON without changing its content', () => {
    expect(parseStructuredJsonByMode('  {"text":"keep ``` inside"}  ', { kind: 'object' })).toEqual({
      ok: true,
      value: { text: 'keep ``` inside' },
    })
  })

  it('accepts one complete outer JSON or unlabeled fence', () => {
    for (const infoString of ['json', 'JSON', '']) {
      const result = parseStructuredJsonByMode(`\`\`\`${infoString}\n{"items":[]}\n\`\`\``, { kind: 'object' })
      expect(result).toEqual({ ok: true, value: { items: [] } })
    }
  })

  it('applies the same outer-fence protocol to array mode', () => {
    const result = parseStructuredJsonByMode('```json\n{"items":[{"id":1}]}\n```', {
      kind: 'array',
      fallbackKey: 'items',
    })
    expect(result).toEqual({ ok: true, value: [{ id: 1 }] })
  })

  it('rejects content repair or a non-canonical envelope', () => {
    for (const input of [
      'Result:\n```json\n{"ok":true}\n```',
      '```javascript\n{"ok":true}\n```',
      '```json\n{"ok":true}',
      '```json\n{"ok":true}\n```\n```json\n{"other":true}\n```',
      '```json\n{"ok":true,}\n```',
    ]) {
      expectParseError(input)
    }
  })

  it('classifies an empty fenced body as an empty response', () => {
    const result = parseStructuredJsonByMode('```json\n   \n```', { kind: 'object' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EMPTY_RESPONSE')
  })
})
