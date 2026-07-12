import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { normalizeProjectAgentToolInput } from '@/lib/operations/tool-input-schema'

describe('project agent tool-input null normalization', () => {
  it('maps strict-model null for an optional field to absence before canonical Zod validation', () => {
    const inputSchema = z.object({
      chapterId: z.string().trim().min(1).optional(),
    })
    const result = normalizeProjectAgentToolInput({
      input: { chapterId: null },
      inputSchema,
      toolInputSchema: {
        type: 'object',
        properties: {
          chapterId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['chapterId'],
        additionalProperties: false,
      },
    })

    expect(result).toEqual({})
    expect(inputSchema.safeParse(result).success).toBe(true)
  })

  it('preserves null when the canonical schema explicitly accepts it', () => {
    const inputSchema = z.object({
      style: z.string().nullable(),
    })
    const result = normalizeProjectAgentToolInput({
      input: { style: null },
      inputSchema,
      toolInputSchema: {
        type: 'object',
        properties: {
          style: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['style'],
        additionalProperties: false,
      },
    })

    expect(result).toEqual({ style: null })
  })
})
