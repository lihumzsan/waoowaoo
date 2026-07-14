import { z } from 'zod'

export const VIDEO_SEGMENT_REFERENCE_KINDS = ['location', 'character'] as const

export const videoSegmentReferenceImageSchema = z.object({
  kind: z.enum(VIDEO_SEGMENT_REFERENCE_KINDS),
  assetId: z.string().trim().min(1),
  mediaId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  source: z.string().trim().min(1),
  order: z.number().int().positive(),
}).strict()

const videoGenerationOptionSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
])

export const videoSegmentTaskPayloadSchema = z.object({
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1),
  editScriptId: z.string().trim().min(1),
  segmentId: z.string().trim().min(1),
  inputSignature: z.string().regex(/^[a-f0-9]{64}$/),
  durationSec: z.number().int().min(1).max(15),
  aspectRatio: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  referenceImages: z.array(videoSegmentReferenceImageSchema).min(1),
  videoModel: z.string().trim().min(1),
  generationOptions: z.record(z.string(), videoGenerationOptionSchema),
  flowId: z.string().trim().min(1).optional(),
  flowStageIndex: z.number().int().positive().optional(),
  flowStageTotal: z.number().int().positive().optional(),
  flowStageTitle: z.string().trim().min(1).optional(),
  ui: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).strict()

export type VideoSegmentReferenceImage = z.infer<typeof videoSegmentReferenceImageSchema>
export type VideoSegmentTaskPayload = z.infer<typeof videoSegmentTaskPayloadSchema>
