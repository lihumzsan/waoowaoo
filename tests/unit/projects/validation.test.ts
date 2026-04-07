import { describe, expect, it } from 'vitest'
import {
  normalizeProjectDraft,
  validateProjectDraft,
} from '@/lib/projects/validation'

describe('project validation', () => {
  it('normalizes blank descriptions to null', () => {
    expect(normalizeProjectDraft({
      name: '  项目 A  ',
      description: '   ',
    })).toEqual({
      name: '项目 A',
      description: null,
    })
  })

  it('rejects descriptions longer than the shared max limit', () => {
    expect(validateProjectDraft({
      name: '项目 A',
      description: 'a'.repeat(501),
    })).toEqual({
      code: 'PROJECT_DESCRIPTION_TOO_LONG',
      field: 'description',
      limit: 500,
    })
  })
})
