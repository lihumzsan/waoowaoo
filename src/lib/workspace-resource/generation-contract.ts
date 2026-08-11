import { z } from 'zod'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import type { WorkspaceResourceJsonValue } from './contracts'
import { workspaceResourceLifecycleProjectionSchema } from './task-runtime-envelope'

export const CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS = 15

export const workspaceResourceInputRefSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
  role: z.string().trim().min(1).max(64),
  position: z.number().int().nonnegative(),
}).strict()

export const workspaceResourceGenerationOptionsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)

const frozenResourceSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
  workspacePath: z.string().trim().min(1).max(512),
  mediaType: z.enum(['image', 'audio', 'video']),
  audioKind: z.enum(['music', 'sound']).optional(),
  schemaId: z.string().trim().min(1).max(96),
  inputHash: z.string().length(64),
  prompt: z.string().min(1).max(100_000)
    .refine((value) => value.trim().length > 0, 'Prompt must contain non-whitespace content.'),
  modelKey: z.string().trim().min(1).max(191),
  inputs: z.array(workspaceResourceInputRefSchema).max(16),
  // Shared task envelope must accept the largest declared image capability.
  // Video models are still constrained to their own max (currently 8) by
  // planning preflight; GPT Image 2 legitimately accepts up to 16 references.
  imageInputPositions: z.array(z.number().int().nonnegative()).max(16),
  audioInputPositions: z.array(z.number().int().nonnegative()).max(3),
  videoInputPositions: z.array(z.number().int().nonnegative()).max(3),
  toolCallId: z.string().trim().min(1).max(191).nullable(),
  sourceTurnId: z.string().trim().min(1).max(191).nullable(),
}).strict().superRefine((resource, context) => {
  const positions = new Set(resource.inputs.map((input) => input.position))
  if (positions.size !== resource.inputs.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['inputs'], message: 'Input positions must be unique.' })
  }
  const providerPositions = [
    ...resource.imageInputPositions,
    ...resource.audioInputPositions,
    ...resource.videoInputPositions,
  ]
  if (new Set(providerPositions).size !== providerPositions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['inputs'], message: 'Provider input roles cannot overlap.' })
  }
  for (const position of providerPositions) {
    if (!positions.has(position)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['inputs'], message: `Unknown provider input position ${String(position)}.` })
    }
  }
  if (resource.mediaType === 'audio' && resource.audioKind === undefined) {
    context.addIssue({ code: 'custom', path: ['audioKind'], message: 'audioKind is required for audio resources.' })
  }
  if (resource.mediaType !== 'audio' && resource.audioKind !== undefined) {
    context.addIssue({ code: 'custom', path: ['audioKind'], message: 'audioKind is forbidden for non-audio resources.' })
  }
  if (resource.audioKind === 'sound' && (
    resource.inputs.length > 0
    || resource.imageInputPositions.length > 0
    || resource.audioInputPositions.length > 0
    || resource.videoInputPositions.length > 0
  )) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Sound resources cannot declare provider references.' })
  }
})

export const workspaceResourceGenerationTaskPayloadSchema = z.object({
  lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
  protocol: z.literal('workspace_resource_generation_v1'),
  resource: frozenResourceSchema,
  imageModel: z.string().trim().min(1).optional(),
  videoModel: z.string().trim().min(1).optional(),
  musicModel: z.string().trim().min(1).optional(),
  soundModel: z.string().trim().min(1).optional(),
  voiceModel: z.string().trim().min(1).optional(),
  previewText: z.string().trim().min(1).max(20_000).optional(),
  language: z.string().trim().min(1).max(32).optional(),
  durationSeconds: z.number().int().min(1).max(600).optional(),
  vocalMode: z.enum(['instrumental', 'vocal']).optional(),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  outputFormat: z.enum(['mp3', 'wav']).optional(),
  scoreCue: z.object({
    key: z.string().trim().min(1).max(191),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  }).strict().refine((cue) => cue.endMs > cue.startMs, { message: 'scoreCue endMs must exceed startMs' }).optional(),
  count: z.literal(1),
  generationOptions: workspaceResourceGenerationOptionsSchema,
  negativePrompt: z.string().trim().min(1).max(100_000).optional(),
}).strict()

const workspaceResourceGenerationTaskEnvelopeSchema = workspaceResourceGenerationTaskPayloadSchema.extend({
  ...taskRuntimePayloadEnvelopeShape,
}).strict()

const workspaceResourceGenerationRetrySourceSchema = workspaceResourceGenerationTaskPayloadSchema.extend({
  resource: frozenResourceSchema.safeExtend({
    inputHash: z.string().trim().min(1).max(64),
  }),
}).strict()

const workspaceResourceGenerationRetrySourceEnvelopeSchema = workspaceResourceGenerationRetrySourceSchema.extend({
  ...taskRuntimePayloadEnvelopeShape,
}).strict()

export type WorkspaceResourceGenerationTaskPayload = z.infer<
  typeof workspaceResourceGenerationTaskPayloadSchema
>

export type WorkspaceResourceGenerationRetrySource = z.infer<
  typeof workspaceResourceGenerationRetrySourceSchema
>

export function parseWorkspaceResourceGenerationTaskPayload(
  value: unknown,
): WorkspaceResourceGenerationTaskPayload {
  const parsed = workspaceResourceGenerationTaskEnvelopeSchema.parse(value)
  return workspaceResourceGenerationTaskPayloadSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    protocol: parsed.protocol,
    resource: parsed.resource,
    imageModel: parsed.imageModel,
    videoModel: parsed.videoModel,
    musicModel: parsed.musicModel,
    soundModel: parsed.soundModel,
    voiceModel: parsed.voiceModel,
    previewText: parsed.previewText,
    language: parsed.language,
    durationSeconds: parsed.durationSeconds,
    vocalMode: parsed.vocalMode,
    genre: parsed.genre,
    mood: parsed.mood,
    bpm: parsed.bpm,
    outputFormat: parsed.outputFormat,
    scoreCue: parsed.scoreCue,
    count: parsed.count,
    generationOptions: parsed.generationOptions,
    negativePrompt: parsed.negativePrompt,
  })
}

/**
 * Retry consumes the previous frozen execution inputs, but never trusts its
 * derived digest. The caller must rebuild a strict current payload and a fresh
 * 64-character input fingerprint before creating the next Task.
 */
export function parseWorkspaceResourceGenerationRetrySource(
  value: unknown,
): WorkspaceResourceGenerationRetrySource {
  const parsed = workspaceResourceGenerationRetrySourceEnvelopeSchema.parse(value)
  return workspaceResourceGenerationRetrySourceSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    protocol: parsed.protocol,
    resource: parsed.resource,
    imageModel: parsed.imageModel,
    videoModel: parsed.videoModel,
    musicModel: parsed.musicModel,
    soundModel: parsed.soundModel,
    voiceModel: parsed.voiceModel,
    previewText: parsed.previewText,
    language: parsed.language,
    durationSeconds: parsed.durationSeconds,
    vocalMode: parsed.vocalMode,
    genre: parsed.genre,
    mood: parsed.mood,
    bpm: parsed.bpm,
    outputFormat: parsed.outputFormat,
    scoreCue: parsed.scoreCue,
    count: parsed.count,
    generationOptions: parsed.generationOptions,
    negativePrompt: parsed.negativePrompt,
  })
}

export function toWorkspaceResourceJsonValue(
  value: z.infer<typeof workspaceResourceGenerationOptionsSchema>,
): WorkspaceResourceJsonValue {
  return value
}
