import { describe, expect, it } from 'vitest'
import {
  assertEditSourceDocumentWithinTokenBudget,
  assertEditSourceRange,
  EditSourceDocumentValidationError,
  estimateEditSourceDocumentInputTokens,
  normalizeEditSourceDocumentText,
  sliceEditSourceText,
} from '@/lib/edit-source-document'

describe('edit source document normalization and offsets', () => {
  it('normalizes line endings and invisible controls without changing legal offset semantics', () => {
    const normalized = normalizeEditSourceDocumentText('\ufeff第一行\r\n第二行\u00a0末尾\r')

    expect(normalized).toBe('第一行\n第二行 末尾')
    expect(sliceEditSourceText(normalized, { sourceStart: 4, sourceEnd: 7 })).toBe('第二行')
  })

  it('rejects invalid half-open source ranges', () => {
    const text = normalizeEditSourceDocumentText('abcdef')

    expect(() => assertEditSourceRange(text, { sourceStart: 3, sourceEnd: 3 }))
      .toThrow('EDIT_SOURCE_RANGE_INVALID')
    expect(() => assertEditSourceRange(text, { sourceStart: 0, sourceEnd: 7 }))
      .toThrow('EDIT_SOURCE_RANGE_INVALID')
  })

  it('estimates tokens deterministically for source budget checks', () => {
    const text = normalizeEditSourceDocumentText('角色A进入 room 7。')

    expect(estimateEditSourceDocumentInputTokens(text)).toBeGreaterThan(0)
    expect(assertEditSourceDocumentWithinTokenBudget(text)).toBe(estimateEditSourceDocumentInputTokens(text))
  })

  it('reports normalized source validation errors with explicit codes', () => {
    expect(() => normalizeEditSourceDocumentText('   ')).toThrow(EditSourceDocumentValidationError)
    try {
      normalizeEditSourceDocumentText('   ')
    } catch (error) {
      expect(error).toBeInstanceOf(EditSourceDocumentValidationError)
      expect((error as EditSourceDocumentValidationError).code).toBe('EDIT_SOURCE_DOCUMENT_EMPTY')
    }
  })

  it('rejects normalized source documents over the ten thousand character episode limit', () => {
    expect(normalizeEditSourceDocumentText('剧'.repeat(10_000))).toHaveLength(10_000)
    expect(() => normalizeEditSourceDocumentText('剧'.repeat(10_001)))
      .toThrow('EDIT_SOURCE_DOCUMENT_CHAR_LIMIT_EXCEEDED:length=10001:max=10000')
  })
})
