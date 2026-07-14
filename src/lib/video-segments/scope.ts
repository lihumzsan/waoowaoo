import { z } from 'zod'

const scopedIdentitySchema = z.string().trim().min(1)

export const videoSegmentGenerationScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pending'),
    chapterId: scopedIdentitySchema.nullable(),
  }).strict(),
  z.object({
    kind: z.literal('segment'),
    chapterId: scopedIdentitySchema,
    editScriptId: scopedIdentitySchema,
    segmentId: scopedIdentitySchema,
  }).strict(),
])

export type VideoSegmentGenerationScope = z.infer<typeof videoSegmentGenerationScopeSchema>
