import { z } from 'zod'

export const creativeStyleBibleSchema = z.object({
  rawUserStyle: z.string().trim().nullable(),
  styleSummary: z.string().trim().min(1),
  visualStyle: z.string().trim().min(1),
  assetImageStyle: z.object({
    lighting: z.string().trim().min(1),
    texture: z.string().trim().min(1),
    composition: z.string().trim().min(1),
  }).strict(),
}).strict()

export type CreativeStyleBible = z.infer<typeof creativeStyleBibleSchema>
