import { z } from 'zod'

export const editSourceRangeSchema = z.object({
  sourceStart: z.number().int().min(0),
  sourceEnd: z.number().int().min(0),
}).refine((value) => value.sourceEnd > value.sourceStart, {
  message: 'sourceEnd must be greater than sourceStart',
  path: ['sourceEnd'],
})

export type EditSourceRange = z.infer<typeof editSourceRangeSchema>
