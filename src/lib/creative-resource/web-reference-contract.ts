import { z } from 'zod'
import { creativeResourceGenerationOptionsSchema } from './generation-contract'
import { CREATIVE_RESOURCE_SCHEMA } from './schema-registry'
import { creativeResourceTaskRuntimeEnvelopeShape } from './task-runtime-envelope'

export const WEB_REFERENCE_IMAGE_SOURCE_TYPE = 'web_search_image'

/**
 * Provenance is not optional metadata here: importing third-party material
 * without recording where it came from leaves nobody able to answer that
 * question later, so the origin page travels with the payload and is frozen
 * into the Revision.
 */
export const webReferenceImageProvenanceSchema = creativeResourceGenerationOptionsSchema
  .superRefine((options, context) => {
    const required = z.object({
      origin: z.literal(WEB_REFERENCE_IMAGE_SOURCE_TYPE),
      imageUrl: z.string().url().max(2_000),
      sourceWebsiteUrl: z.string().url().max(2_000),
    })
    const parsed = required.safeParse(options)
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        message: 'WEB_REFERENCE_IMAGE_PROVENANCE_REQUIRED',
      })
    }
  })

export function buildWebReferenceImageProvenance(input: {
  readonly imageUrl: string
  readonly sourceWebsiteUrl: string
  readonly caption: string | null
}): Record<string, string> {
  return {
    origin: WEB_REFERENCE_IMAGE_SOURCE_TYPE,
    imageUrl: input.imageUrl,
    sourceWebsiteUrl: input.sourceWebsiteUrl,
    ...(input.caption ? { caption: input.caption } : {}),
  }
}

export function readWebReferenceImageUrl(
  options: Record<string, unknown>,
): string {
  const value = options.imageUrl
  if (typeof value !== 'string' || !value) {
    throw new Error('WEB_REFERENCE_IMAGE_URL_MISSING')
  }
  return value
}

export const creativeResourceWebReferenceTaskPayloadSchema = z.object({
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('image'),
    schemaId: z.literal(CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().trim().min(1),
    inputs: z.tuple([]),
    generationOptions: webReferenceImageProvenanceSchema,
    executionSegmentId: z.string().trim().min(1).nullable(),
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict(),
}).strict()

const creativeResourceWebReferenceTaskEnvelopeSchema = creativeResourceWebReferenceTaskPayloadSchema.extend({
  ...creativeResourceTaskRuntimeEnvelopeShape,
}).strict()

export type CreativeResourceWebReferenceTaskPayload = z.infer<
  typeof creativeResourceWebReferenceTaskPayloadSchema
>
export type WebReferenceImageProvenance = z.infer<typeof webReferenceImageProvenanceSchema>

export function parseCreativeResourceWebReferenceTaskPayload(
  input: unknown,
): CreativeResourceWebReferenceTaskPayload {
  return creativeResourceWebReferenceTaskEnvelopeSchema.parse(input)
}
