import { z } from 'zod'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import type { WorkspaceResourceJsonValue } from './contracts'
import { workspaceResourceLifecycleProjectionSchema } from './task-runtime-envelope'
import { vocalPerformanceModeSchema } from './vocal-performance-contract'
import {
  audioExecutionModeSchema,
  frozenAudioExecutionSchema,
} from './audio-execution-contract'

export const CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS = 15

export const workspaceResourceInputRefSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
  role: z.string().trim().min(1).max(64),
  position: z.number().int().nonnegative(),
}).strict()

const workspaceResourceJsonValueSchema: z.ZodType<WorkspaceResourceJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(workspaceResourceJsonValueSchema),
  z.record(z.string(), workspaceResourceJsonValueSchema),
]))

export const workspaceResourceGenerationOptionsSchema = z.record(
  z.string(),
  workspaceResourceJsonValueSchema,
)

function frozenAudioExecutionIssuePath(path: readonly PropertyKey[]): PropertyKey[] {
  const [field, ...rest] = path
  if (field === 'mode') return ['audioExecutionMode', ...rest]
  if (field === 'audioKind') return ['resource', 'audioKind', ...rest]
  if (field === 'prompt') return ['resource', 'prompt', ...rest]
  if (field === 'durationSeconds') return ['durationSeconds', ...rest]
  if (field === 'generationOptions') return ['generationOptions', ...rest]
  return ['audioExecutionMode', ...path]
}

const frozenResourceSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
  workspacePath: z.string().trim().min(1).max(512),
  mediaType: z.enum(['image', 'audio', 'video']),
  audioKind: z.enum(['music', 'sound']).optional(),
  schemaId: z.string().trim().min(1).max(96),
  inputHash: z.string().length(64),
  prompt: z.string().min(1).max(100_000)
    .refine((value) => value.trim().length > 0, 'Prompt must contain non-whitespace content.')
    .nullable(),
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
  protocol: z.literal('workspace_resource_generation_v2'),
  resource: frozenResourceSchema,
  imageModel: z.string().trim().min(1).optional(),
  videoModel: z.string().trim().min(1).optional(),
  musicModel: z.string().trim().min(1).optional(),
  soundModel: z.string().trim().min(1).optional(),
  voiceModel: z.string().trim().min(1).optional(),
  previewText: z.string().trim().min(1).max(20_000).optional(),
  language: z.string().trim().min(1).max(32).optional(),
  audioExecutionMode: audioExecutionModeSchema.optional(),
  durationSeconds: z.number().int().min(1).max(600).optional(),
  scoreCue: z.object({
    key: z.string().trim().min(1).max(191),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  }).strict().refine((cue) => cue.endMs > cue.startMs, { message: 'scoreCue endMs must exceed startMs' }).optional(),
  count: z.literal(1),
  generationOptions: workspaceResourceGenerationOptionsSchema,
  vocalPerformanceMode: vocalPerformanceModeSchema.optional(),
}).strict().superRefine((payload, context) => {
  if (payload.resource.mediaType === 'audio') {
    const audioExecution = frozenAudioExecutionSchema.safeParse({
      mode: payload.audioExecutionMode,
      audioKind: payload.resource.audioKind,
      prompt: payload.resource.prompt,
      durationSeconds: payload.durationSeconds ?? null,
      generationOptions: payload.generationOptions,
    })
    if (!audioExecution.success) {
      for (const issue of audioExecution.error.issues) {
        context.addIssue({
          ...issue,
          path: frozenAudioExecutionIssuePath(issue.path),
        })
      }
    } else {
      const scoreSpecification = audioExecution.data.generationOptions
      const timelineInputPosition = 'timelineInputPosition' in scoreSpecification
        ? scoreSpecification.timelineInputPosition
        : null
      if (timelineInputPosition !== null && !payload.resource.inputs.some((reference) => (
        reference.position === timelineInputPosition
        && reference.role === 'score_timeline'
      ))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['generationOptions', 'timelineInputPosition'],
          message: 'Music score timelineInputPosition must identify the frozen score_timeline input.',
        })
      }
    }
  } else if (payload.audioExecutionMode !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['audioExecutionMode'],
      message: 'audioExecutionMode is only valid for audio resources.',
    })
  }
  if (payload.resource.mediaType === 'video' && payload.vocalPerformanceMode === undefined) {
    context.addIssue({ code: 'custom', path: ['vocalPerformanceMode'], message: 'video tasks must declare vocalPerformanceMode.' })
  }
  if (payload.resource.mediaType !== 'video' && payload.vocalPerformanceMode !== undefined) {
    context.addIssue({ code: 'custom', path: ['vocalPerformanceMode'], message: 'Only video tasks may declare vocalPerformanceMode.' })
  }
  if (payload.resource.mediaType !== 'audio' && payload.resource.prompt === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resource', 'prompt'],
      message: 'Image and video generation require a prompt.',
    })
  }
  if (payload.resource.mediaType === 'video' && payload.durationSeconds === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['durationSeconds'],
      message: 'Video generation requires durationSeconds.',
    })
  }
})

const workspaceResourceGenerationTaskEnvelopeSchema = workspaceResourceGenerationTaskPayloadSchema.safeExtend({
  ...taskRuntimePayloadEnvelopeShape,
}).strict()

const workspaceResourceGenerationRetrySourceSchema = workspaceResourceGenerationTaskPayloadSchema.safeExtend({
  resource: frozenResourceSchema.safeExtend({
    inputHash: z.string().trim().min(1).max(64),
  }),
}).strict()

const workspaceResourceGenerationRetrySourceEnvelopeSchema = workspaceResourceGenerationRetrySourceSchema.safeExtend({
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
    audioExecutionMode: parsed.audioExecutionMode,
    durationSeconds: parsed.durationSeconds,
    scoreCue: parsed.scoreCue,
    count: parsed.count,
    generationOptions: parsed.generationOptions,
    vocalPerformanceMode: parsed.vocalPerformanceMode,
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
    audioExecutionMode: parsed.audioExecutionMode,
    durationSeconds: parsed.durationSeconds,
    scoreCue: parsed.scoreCue,
    count: parsed.count,
    generationOptions: parsed.generationOptions,
    vocalPerformanceMode: parsed.vocalPerformanceMode,
  })
}

export function toWorkspaceResourceJsonValue(
  value: z.infer<typeof workspaceResourceGenerationOptionsSchema>,
): WorkspaceResourceJsonValue {
  return value
}
