import { z } from 'zod'

export const creativeDirectionVisualSchema = z.object({
  visualStyle: z.string().trim().min(1),
  assetImageStyle: z.object({
    lighting: z.string().trim().min(1),
    texture: z.string().trim().min(1),
  }).strict(),
}).strict()

export const creativeDirectionSchema = z.object({
  styleSummary: z.string().trim().min(1),
  rawUserStyle: z.string().trim().nullable(),
  visual: creativeDirectionVisualSchema,
  narrative: z.string().trim().min(1),
  directing: z.string().trim().min(1),
  editing: z.string().trim().min(1),
  sound: z.string().trim().min(1),
  assetPolicy: z.string().trim().min(1),
}).strict()

export type CreativeDirection = z.infer<typeof creativeDirectionSchema>

export const injectedCreativeDirectionSchema = z.object({
  resourceId: z.string().trim().min(1),
  direction: creativeDirectionSchema,
}).strict()

export type InjectedCreativeDirection = z.infer<typeof injectedCreativeDirectionSchema>
