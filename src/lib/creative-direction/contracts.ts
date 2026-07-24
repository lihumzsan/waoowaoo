import { z } from 'zod'

export const CREATIVE_DIRECTION_DOMAINS = [
  'visual',
  'narrative',
  'directing',
  'editing',
  'sound',
  'assetPolicy',
] as const

export type CreativeDirectionDomain = (typeof CREATIVE_DIRECTION_DOMAINS)[number]

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

const creativeDirectionProjectionShape = {
  visual: creativeDirectionVisualSchema.optional(),
  narrative: creativeDirectionSchema.shape.narrative.optional(),
  directing: creativeDirectionSchema.shape.directing.optional(),
  editing: creativeDirectionSchema.shape.editing.optional(),
  sound: creativeDirectionSchema.shape.sound.optional(),
  assetPolicy: creativeDirectionSchema.shape.assetPolicy.optional(),
} as const

export const creativeDirectionProjectionSchema = z.object(
  creativeDirectionProjectionShape,
).strict().superRefine((projection, context) => {
  if (Object.keys(projection).length > 0) return
  context.addIssue({
    code: 'custom',
    message: 'CREATIVE_DIRECTION_PROJECTION_EMPTY',
  })
})

export type CreativeDirectionProjection = z.infer<typeof creativeDirectionProjectionSchema>

export const injectedCreativeDirectionSchema = z.object({
  revisionId: z.string().trim().min(1),
  direction: creativeDirectionProjectionSchema,
}).strict()

export type InjectedCreativeDirection = z.infer<typeof injectedCreativeDirectionSchema>

export function projectCreativeDirection(
  direction: CreativeDirection,
  domains: readonly CreativeDirectionDomain[],
): CreativeDirectionProjection {
  const projected: Partial<Record<CreativeDirectionDomain, CreativeDirection[CreativeDirectionDomain]>> = {}
  for (const domain of domains) {
    if (domain === 'visual') {
      projected.visual = direction.visual
      continue
    }
    projected[domain] = direction[domain]
  }
  return creativeDirectionProjectionSchema.parse(projected)
}
