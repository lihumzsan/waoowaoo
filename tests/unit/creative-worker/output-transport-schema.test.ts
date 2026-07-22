import { describe, expect, it } from 'vitest'
import {
  buildCreativeWorkerOutputTransportSchema,
  creativeWorkOutputRegistry,
  creativeWorkOutputSchemas,
  normalizeCreativeWorkerOutputFromTransport,
} from '@/lib/creative-worker'
import { z } from 'zod'

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, keys))
    return keys
  }
  if (!value || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value)) {
    keys.add(key)
    collectKeys(child, keys)
  }
  return keys
}

describe('Creative Worker structured-output transport schema', () => {
  it('derives an Azure-compatible shape schema for every registered output kind', () => {
    const forbiddenKeywords = [
      '$schema',
      'contains',
      'const',
      'default',
      'exclusiveMaximum',
      'exclusiveMinimum',
      'format',
      'maxContains',
      'maxItems',
      'maxLength',
      'maxProperties',
      'maximum',
      'minContains',
      'minItems',
      'minLength',
      'minProperties',
      'minimum',
      'multipleOf',
      'oneOf',
      'pattern',
      'patternProperties',
      'propertyNames',
      'unevaluatedItems',
      'unevaluatedProperties',
      'uniqueItems',
    ]

    for (const definition of Object.values(creativeWorkOutputRegistry)) {
      const transport = buildCreativeWorkerOutputTransportSchema(definition)
      const keys = collectKeys(transport.schema)
      expect(transport).toMatchObject({
        type: 'json_schema',
        strict: true,
        name: `creative_${definition.kind}`,
      })
      expect(forbiddenKeywords.filter((keyword) => keys.has(keyword)), definition.kind).toEqual([])
    }
  })

  it('represents optional fields as required nullable transport fields and restores omission locally', () => {
    const schema = z.object({
      kind: z.literal('canonical_screenplay'),
      note: z.string().optional(),
    }).strict()
    const transport = buildCreativeWorkerOutputTransportSchema({
      kind: 'canonical_screenplay',
      schema,
    })

    expect(transport.schema.required).toEqual(['kind', 'note'])
    expect(transport.schema.properties.note).toMatchObject({
      anyOf: expect.arrayContaining([{ type: 'null' }]),
    })
    const normalized = normalizeCreativeWorkerOutputFromTransport({
      schema,
      value: { kind: 'canonical_screenplay', note: null },
    })
    expect(normalized).toEqual({ kind: 'canonical_screenplay' })
    expect(schema.safeParse(normalized).success).toBe(true)
  })

  it('keeps business limits authoritative in the original Zod output schema', () => {
    const invalidStyleOutput = {
      kind: 'style_bible',
      design: { mode: 'candidates', candidates: [] },
      assumptions: [],
      warnings: [],
    }

    expect(creativeWorkOutputSchemas.style_bible.safeParse(invalidStyleOutput).success).toBe(false)
  })
})
