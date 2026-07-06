import { z } from 'zod'

export const editSourceDocumentKindSchema = z.enum(['upload', 'paste', 'prompt_generated_outline'])

export type EditSourceDocumentKind = z.infer<typeof editSourceDocumentKindSchema>

export const createEditSourceDocumentInputSchema = z.object({
  episodeId: z.string().trim().min(1),
  sourceKind: editSourceDocumentKindSchema,
  text: z.string().min(1),
  rawFileMediaId: z.string().trim().min(1).optional(),
})

export type CreateEditSourceDocumentInput = z.infer<typeof createEditSourceDocumentInputSchema>

export const editSourceRangeSchema = z.object({
  sourceStart: z.number().int().min(0),
  sourceEnd: z.number().int().min(0),
}).refine((value) => value.sourceEnd > value.sourceStart, {
  message: 'sourceEnd must be greater than sourceStart',
  path: ['sourceEnd'],
})

export type EditSourceRange = z.infer<typeof editSourceRangeSchema>
