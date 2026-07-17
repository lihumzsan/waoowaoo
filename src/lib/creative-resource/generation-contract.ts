import { z } from 'zod'
import { CREATIVE_RESOURCE_MEDIA_TYPES, type CreativeResourceJsonValue } from './contracts'

export const creativeResourceInputRefSchema = z.object({
  resourceId: z.string().trim().min(1)
    .describe('Exact Resource identity returned by list_resources or get_resource.'),
  revisionId: z.string().trim().min(1)
    .describe('Exact immutable revision identity returned for that Resource.'),
  fingerprint: z.string().trim().min(1)
    .describe('Exact revision fingerprint returned with revisionId; never invent or recompute it.'),
  role: z.string().trim().min(1).optional()
    .describe('Optional semantic role of this reference in the new output, such as character, location, or source_video.'),
}).strict()

export const creativeResourceGenerationOptionsSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
  ]),
)

export const creativeResourceGenerationTaskPayloadSchema = z.object({
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
    schemaId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    modelKey: z.string().trim().min(1),
    inputHash: z.string().trim().min(1),
    inputs: z.array(z.object({
      resourceId: z.string().trim().min(1),
      revisionId: z.string().trim().min(1),
      fingerprint: z.string().trim().min(1),
      role: z.string().trim().min(1),
      position: z.number().int().min(0),
    }).strict()),
    generationOptions: creativeResourceGenerationOptionsSchema,
    executionSegmentId: z.string().trim().min(1).nullable(),
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict(),
  imageModel: z.string().trim().min(1).optional(),
  videoModel: z.string().trim().min(1).optional(),
  musicModel: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
  durationSeconds: z.number().int().positive().optional(),
  vocalMode: z.enum(['instrumental', 'vocal']).optional(),
  genre: z.string().trim().min(1).optional(),
  mood: z.string().trim().min(1).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  outputFormat: z.enum(['mp3', 'wav']).optional(),
  count: z.literal(1),
  generationOptions: creativeResourceGenerationOptionsSchema,
}).strict()

export type CreativeResourceGenerationTaskPayload = z.infer<
  typeof creativeResourceGenerationTaskPayloadSchema
>

const creativeResourceGenerationTaskEnvelopeSchema = creativeResourceGenerationTaskPayloadSchema.extend({
  ui: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  externalId: z.string().trim().min(1).optional(),
  flowId: z.string().optional(),
  flowStageIndex: z.number().optional(),
  flowStageTotal: z.number().optional(),
  flowStageTitle: z.string().optional(),
  stage: z.string().optional(),
  stageLabel: z.string().optional(),
  displayMode: z.string().optional(),
  message: z.string().optional(),
}).strict()

/**
 * Task persistence adds a small, explicit UI/progress envelope around the
 * immutable business payload. Parse that envelope exhaustively, then return
 * only the frozen generation contract consumed by workers/materializers.
 */
export function parseCreativeResourceGenerationTaskPayload(
  value: unknown,
): CreativeResourceGenerationTaskPayload {
  const parsed = creativeResourceGenerationTaskEnvelopeSchema.parse(value)
  return creativeResourceGenerationTaskPayloadSchema.parse({
    resource: parsed.resource,
    imageModel: parsed.imageModel,
    videoModel: parsed.videoModel,
    musicModel: parsed.musicModel,
    prompt: parsed.prompt,
    durationSeconds: parsed.durationSeconds,
    vocalMode: parsed.vocalMode,
    genre: parsed.genre,
    mood: parsed.mood,
    bpm: parsed.bpm,
    outputFormat: parsed.outputFormat,
    count: parsed.count,
    generationOptions: parsed.generationOptions,
  })
}

export function toCreativeResourceJsonValue(
  value: z.infer<typeof creativeResourceGenerationOptionsSchema>,
): CreativeResourceJsonValue {
  return value as CreativeResourceJsonValue
}
