import { z } from 'zod'
import { editSourceRangeSchema } from '@/lib/edit-source-document/schemas'

export const ledgerEntityRefSchema = z.object({
  entityType: z.enum(['character', 'location', 'prop', 'world']),
  entityName: z.string().trim().min(1),
})

export type LedgerEntityRef = z.infer<typeof ledgerEntityRefSchema>

export const ledgerEventSchema = editSourceRangeSchema.extend({
  eventId: z.string().trim().min(1),
  kind: z.enum(['appearance', 'relationship', 'location', 'prop', 'plot', 'rule', 'emotion']),
  summary: z.string().trim().min(1),
  entities: z.array(ledgerEntityRefSchema).default([]),
  persistentFacts: z.array(z.string().trim().min(1)).default([]),
})

export type LedgerEvent = z.infer<typeof ledgerEventSchema>

export const ledgerSchema = z.object({
  events: z.array(ledgerEventSchema),
})

export type Ledger = z.infer<typeof ledgerSchema>

export const ledgerSnapshotSchema = z.object({
  sourceEnd: z.number().int().min(0),
  facts: z.array(z.string().trim().min(1)),
  entities: z.array(ledgerEntityRefSchema),
})

export type LedgerSnapshot = z.infer<typeof ledgerSnapshotSchema>
