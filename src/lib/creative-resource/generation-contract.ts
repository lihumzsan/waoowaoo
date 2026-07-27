import { z } from 'zod'
import { CREATIVE_RESOURCE_MEDIA_TYPES, type CreativeResourceJsonValue } from './contracts'
import { creativeResourceTaskRuntimeEnvelopeShape } from './task-runtime-envelope'

export const CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS = 15

export const creativeResourceInputRefSchema = z.object({
  revisionId: z.string().trim().min(1)
    .describe('Globally unique immutable Resource Revision identity. The server resolves its Resource, schema, owner, and scope.'),
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
      revisionId: z.string().trim().min(1),
      role: z.string().trim().min(1),
      position: z.number().int().min(0),
    }).strict()),
    imageInputPositions: z.array(z.number().int().min(0)).max(8)
      .superRefine((positions, context) => {
        if (new Set(positions).size !== positions.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'imageInputPositions must contain unique Resource input positions.',
          })
        }
      }),
    audioInputPositions: z.array(z.number().int().min(0)).max(3)
      .superRefine((positions, context) => {
        if (new Set(positions).size !== positions.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'audioInputPositions must contain unique Resource input positions.',
          })
        }
      }),
    // Frozen payloads created before video conditioning existed carry no
    // videoInputPositions; absent means "no video reference", not a second
    // interpretation, so retry replays them unchanged.
    videoInputPositions: z.array(z.number().int().min(0)).max(1)
      .superRefine((positions, context) => {
        if (new Set(positions).size !== positions.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'videoInputPositions must contain unique Resource input positions.',
          })
        }
      })
      .default([]),
    generationOptions: creativeResourceGenerationOptionsSchema,
    executionSegmentId: z.string().trim().min(1).nullable(),
    toolCallId: z.string().trim().min(1).nullable(),
    binding: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('character_voice'),
        characterId: z.string().trim().min(1),
        expectedVersion: z.number().int().min(0).nullable(),
      }).strict(),
      z.object({
        kind: z.literal('project_asset_image'),
        assetKind: z.enum(['character', 'location', 'prop']),
        assetId: z.string().trim().min(1),
        variantId: z.string().trim().min(1),
        expectedVersion: z.number().int().min(0).nullable(),
      }).strict(),
    ]).optional(),
  }).strict().superRefine((resource, context) => {
    const inputPositions = new Set(resource.inputs.map((input) => input.position))
    if (inputPositions.size !== resource.inputs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputs'],
        message: 'Resource input positions must be unique.',
      })
    }
    for (const position of resource.imageInputPositions) {
      if (!inputPositions.has(position)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['imageInputPositions'],
          message: `imageInputPositions contains unknown Resource input position ${String(position)}.`,
        })
      }
    }
    for (const position of resource.audioInputPositions) {
      if (!inputPositions.has(position)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['audioInputPositions'],
          message: `audioInputPositions contains unknown Resource input position ${String(position)}.`,
        })
      }
    }
    for (const position of resource.videoInputPositions) {
      if (!inputPositions.has(position)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['videoInputPositions'],
          message: `videoInputPositions contains unknown Resource input position ${String(position)}.`,
        })
      }
    }
    const imagePositions = new Set(resource.imageInputPositions)
    for (const position of resource.audioInputPositions) {
      if (imagePositions.has(position)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['audioInputPositions'],
          message: `Resource input position ${String(position)} cannot be both an image and audio reference.`,
        })
      }
    }
    const audioPositions = new Set(resource.audioInputPositions)
    for (const position of resource.videoInputPositions) {
      if (imagePositions.has(position) || audioPositions.has(position)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['videoInputPositions'],
          message: `Resource input position ${String(position)} cannot be both a video and another provider reference.`,
        })
      }
    }
  }),
  imageModel: z.string().trim().min(1).optional(),
  videoModel: z.string().trim().min(1).optional(),
  musicModel: z.string().trim().min(1).optional(),
  voiceModel: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
  previewText: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
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
  ...creativeResourceTaskRuntimeEnvelopeShape,
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
    voiceModel: parsed.voiceModel,
    prompt: parsed.prompt,
    previewText: parsed.previewText,
    language: parsed.language,
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
