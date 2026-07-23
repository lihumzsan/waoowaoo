import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createProjectAgentToolInputSchema,
  normalizeProjectAgentToolInput,
} from '@/lib/operations/tool-input-schema'

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

  it('normalizes optional null inside the selected discriminated-union branch', () => {
    const inputSchema = z.object({
      request: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('new'),
          schemaId: z.enum(['generic.image']).optional(),
        }).strict(),
        z.object({
          kind: z.literal('retry'),
          resourceIds: z.array(z.string()).min(1),
        }).strict(),
      ]),
    }).strict()
    const result = normalizeProjectAgentToolInput({
      input: { request: { kind: 'new', schemaId: null } },
      inputSchema,
      toolInputSchema: {
        type: 'object',
        properties: {
          request: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  kind: { const: 'new' },
                  schemaId: { type: ['string', 'null'], enum: ['generic.image', null] },
                },
                required: ['kind', 'schemaId'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { const: 'retry' },
                  resourceIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['kind', 'resourceIds'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['request'],
        additionalProperties: false,
      },
    })

    expect(result).toEqual({ request: { kind: 'new' } })
    expect(inputSchema.safeParse(result).success).toBe(true)
  })

  it('omits optional nulls while preserving a required canonical null in the same branch', () => {
    const inputSchema = z.object({
      request: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('asset'),
          contextReferences: z.array(z.string()).optional(),
          imageReferences: z.array(z.string()).optional(),
          assetBinding: z.object({
            assetId: z.string().min(1),
            expectedVersion: z.number().int().nonnegative().nullable(),
          }).strict(),
        }).strict(),
        z.object({
          kind: z.literal('retry'),
          resourceIds: z.array(z.string()).min(1),
        }).strict(),
      ]),
    }).strict()
    const toolInputSchema = createProjectAgentToolInputSchema({
      operationId: 'test_mixed_nullable_input',
      inputSchema,
    })
    const result = normalizeProjectAgentToolInput({
      input: {
        request: {
          kind: 'asset',
          contextReferences: null,
          imageReferences: null,
          assetBinding: {
            assetId: 'asset-1',
            expectedVersion: null,
          },
        },
      },
      inputSchema,
      toolInputSchema,
    })

    expect(result).toEqual({
      request: {
        kind: 'asset',
        assetBinding: {
          assetId: 'asset-1',
          expectedVersion: null,
        },
      },
    })
    expect(inputSchema.safeParse(result).success).toBe(true)
  })
})
