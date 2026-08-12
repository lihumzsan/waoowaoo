import { z } from 'zod'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import { workspaceResourceLifecycleProjectionSchema } from './task-runtime-envelope'
import { workspaceResourceGenerationOptionsSchema } from './generation-contract'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'

export const voiceoverLanguageSchema = z.enum(['auto', 'zh', 'en', 'ja', 'ko'])
export const frozenVoiceoverInputSchema = z.object({
  resourceId: z.string().trim().min(1),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
}).strict()

export const workspaceResourceVoiceoverGenerationOptionsSchema = z.object({
  language: voiceoverLanguageSchema,
  referenceAudio: z.string().trim().min(1),
  referenceAudioDurationMs: z.number().int().min(3000).max(10000),
  outputFormat: z.literal('mp3'),
}).strict()

export function buildWorkspaceResourceVoiceoverInputIdentity(input: {
  readonly prompt: string
  readonly modelKey: string
  readonly inputs: ReadonlyArray<z.infer<typeof frozenVoiceoverInputSchema> & { readonly role: 'reference_audio'; readonly position: 0 }>
  readonly generationOptions: {
    readonly language: string
    readonly referenceAudio: string
    readonly referenceAudioDurationMs: number
    readonly outputFormat: string
  }
}): string {
  return stableArgsFingerprint({
    prompt: input.prompt,
    modelKey: input.modelKey,
    inputs: input.inputs,
    generationOptions: {
      language: input.generationOptions.language,
      referenceAudio: input.generationOptions.referenceAudio,
      referenceAudioDurationMs: input.generationOptions.referenceAudioDurationMs,
      outputFormat: input.generationOptions.outputFormat,
    },
  })
}

function validateLifecycleProjection(
  payload: {
    lifecycleProjection: z.infer<typeof workspaceResourceLifecycleProjectionSchema>
    resource: { resourceId: string; mediaType: 'audio' | 'video'; schemaId: string }
  },
  context: z.RefinementCtx,
): void {
  const [projection] = payload.lifecycleProjection.resources
  if (
    payload.lifecycleProjection.resources.length !== 1
    || !projection
    || projection.resourceId !== payload.resource.resourceId
    || projection.mediaType !== payload.resource.mediaType
    || projection.schemaId !== payload.resource.schemaId
  ) {
    context.addIssue({ code: 'custom', path: ['lifecycleProjection'], message: 'Lifecycle projection must match the frozen Task Resource.' })
  }
}

export const workspaceResourceVoiceoverTaskPayloadSchema = z.object({
  lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
  protocol: z.literal('workspace_resource_voiceover_v1'),
  resource: z.object({
    resourceId: z.string().trim().min(1),
    workspacePath: z.string().trim().min(1).max(512),
    mediaType: z.literal('audio'),
    schemaId: z.literal('project.voiceover_audio'),
    inputHash: z.string().length(64),
    prompt: z.string().trim().min(1).max(4096),
    modelKey: z.string().trim().min(1),
    inputs: z.array(z.object({
      ...frozenVoiceoverInputSchema.shape,
      role: z.literal('reference_audio'),
      position: z.literal(0),
    }).strict()).length(1),
    toolCallId: z.string().trim().min(1).nullable(),
    sourceTurnId: z.string().trim().min(1).nullable(),
  }).strict(),
  voiceModel: z.string().trim().min(1),
  referenceAudio: frozenVoiceoverInputSchema,
  text: z.string().trim().min(1).max(4096),
  language: voiceoverLanguageSchema,
  outputFormat: z.literal('mp3'),
  generationOptions: workspaceResourceVoiceoverGenerationOptionsSchema,
}).strict().superRefine((payload, context) => {
  validateLifecycleProjection(payload, context)
  if (payload.text !== payload.resource.prompt) {
    context.addIssue({ code: 'custom', path: ['text'], message: 'text must match the frozen Resource prompt.' })
  }
  if (payload.voiceModel !== payload.resource.modelKey) {
    context.addIssue({ code: 'custom', path: ['voiceModel'], message: 'voiceModel must match the frozen Resource model.' })
  }
  if (payload.language !== payload.generationOptions.language) {
    context.addIssue({ code: 'custom', path: ['language'], message: 'language must match frozen generationOptions.' })
  }
  if (payload.outputFormat !== payload.generationOptions.outputFormat) {
    context.addIssue({ code: 'custom', path: ['outputFormat'], message: 'outputFormat must match frozen generationOptions.' })
  }
  const inputReference = payload.resource.inputs[0]
  if (
    !inputReference
    || inputReference.resourceId !== payload.referenceAudio.resourceId
    || inputReference.contentVersion !== payload.referenceAudio.contentVersion
    || inputReference.workspacePath !== payload.referenceAudio.workspacePath
  ) {
    context.addIssue({ code: 'custom', path: ['referenceAudio'], message: 'referenceAudio must match the frozen Resource input.' })
  }
})

const voiceoverMixInputBaseSchema = z.object({
  resourceId: z.string().trim().min(1),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
})

const voiceoverMixInputSchema = z.discriminatedUnion('role', [
  voiceoverMixInputBaseSchema.extend({
    role: z.literal('source_video'),
    position: z.literal(0),
  }).strict(),
  voiceoverMixInputBaseSchema.extend({
    role: z.literal('reference_audio'),
    position: z.literal(0),
  }).strict(),
  voiceoverMixInputBaseSchema.extend({
    role: z.literal('voiceover_audio'),
    position: z.number().int().nonnegative(),
    startSeconds: z.number().finite().nonnegative(),
  }).strict(),
  voiceoverMixInputBaseSchema.extend({
    role: z.literal('bgm_audio'),
    position: z.literal(0),
  }).strict(),
])

export const workspaceResourceVoiceoverMixTaskPayloadSchema = z.object({
  lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
  protocol: z.literal('workspace_resource_voiceover_mix_v1'),
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('video'),
    schemaId: z.literal('generic.video'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().length(64),
    inputs: z.array(voiceoverMixInputSchema).min(3),
    generationOptions: workspaceResourceGenerationOptionsSchema,
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict(),
}).strict().superRefine((payload, context) => {
  validateLifecycleProjection(payload, context)
  const inputs = payload.resource.inputs
  for (const role of ['source_video', 'reference_audio'] as const) {
    if (inputs.filter((input) => input.role === role).length !== 1) {
      context.addIssue({ code: 'custom', path: ['resource', 'inputs'], message: `Exactly one ${role} input is required.` })
    }
  }
  if (inputs.filter((input) => input.role === 'bgm_audio').length > 1) {
    context.addIssue({ code: 'custom', path: ['resource', 'inputs'], message: 'At most one bgm_audio input is allowed.' })
  }
  const narrationPositions = inputs
    .filter((input) => input.role === 'voiceover_audio')
    .map((input) => input.position)
    .sort((left, right) => left - right)
  if (
    narrationPositions.length === 0
    || narrationPositions.some((position, index) => position !== index)
  ) {
    context.addIssue({ code: 'custom', path: ['resource', 'inputs'], message: 'Narration positions must be unique and contiguous from zero.' })
  }
})

const voiceoverTaskEnvelope = workspaceResourceVoiceoverTaskPayloadSchema.extend({ ...taskRuntimePayloadEnvelopeShape }).strict()
const mixTaskEnvelope = workspaceResourceVoiceoverMixTaskPayloadSchema.extend({ ...taskRuntimePayloadEnvelopeShape }).strict()

export type WorkspaceResourceVoiceoverTaskPayload = z.infer<typeof workspaceResourceVoiceoverTaskPayloadSchema>
export type WorkspaceResourceVoiceoverMixTaskPayload = z.infer<typeof workspaceResourceVoiceoverMixTaskPayloadSchema>
export type WorkspaceResourceVoiceoverTaskTarget = { readonly targetType: string; readonly targetId: string }
export type WorkspaceResourceVoiceoverResourceFacts = {
  readonly resourceId: string
  readonly workspacePath: string | null
  readonly mediaType: 'audio' | 'video'
  readonly schemaId: string
  readonly prompt: string | null
  readonly modelKey: string | null
  readonly inputHash: string
  readonly inputs: WorkspaceResourceVoiceoverTaskPayload['resource']['inputs'] | WorkspaceResourceVoiceoverMixTaskPayload['resource']['inputs']
  readonly generationOptions: z.infer<typeof workspaceResourceGenerationOptionsSchema>
  readonly toolCallId: string | null
  readonly sourceTurnId: string | null
}
export type NormalizedWorkspaceResourceVoiceoverTaskPayload = WorkspaceResourceVoiceoverTaskPayload & {
  resourceFacts: WorkspaceResourceVoiceoverResourceFacts
}
export type NormalizedWorkspaceResourceVoiceoverMixTaskPayload = WorkspaceResourceVoiceoverMixTaskPayload & {
  resourceFacts: WorkspaceResourceVoiceoverResourceFacts
  inputAggregate: {
    source: Extract<WorkspaceResourceVoiceoverMixTaskPayload['resource']['inputs'][number], { role: 'source_video' }>
    reference: Extract<WorkspaceResourceVoiceoverMixTaskPayload['resource']['inputs'][number], { role: 'reference_audio' }>
    narrations: Array<Extract<WorkspaceResourceVoiceoverMixTaskPayload['resource']['inputs'][number], { role: 'voiceover_audio' }>>
    bgm?: Extract<WorkspaceResourceVoiceoverMixTaskPayload['resource']['inputs'][number], { role: 'bgm_audio' }>
  }
}

function validateTaskTarget(resourceId: string, target?: WorkspaceResourceVoiceoverTaskTarget): void {
  if (target && (target.targetType !== 'WorkspaceResource' || target.targetId !== resourceId)) {
    throw new Error('WORKSPACE_RESOURCE_VOICEOVER_TASK_TARGET_MISMATCH')
  }
}

export function parseWorkspaceResourceVoiceoverTaskPayload(
  value: unknown,
  target?: WorkspaceResourceVoiceoverTaskTarget,
): NormalizedWorkspaceResourceVoiceoverTaskPayload {
  const parsed = voiceoverTaskEnvelope.parse(value)
  const payload = workspaceResourceVoiceoverTaskPayloadSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    protocol: parsed.protocol,
    resource: parsed.resource,
    voiceModel: parsed.voiceModel,
    referenceAudio: parsed.referenceAudio,
    text: parsed.text,
    language: parsed.language,
    outputFormat: parsed.outputFormat,
    generationOptions: parsed.generationOptions,
  })
  validateTaskTarget(payload.resource.resourceId, target)
  return {
    ...payload,
    resourceFacts: {
      ...payload.resource,
      generationOptions: payload.generationOptions,
    },
  }
}

export function parseWorkspaceResourceVoiceoverMixTaskPayload(
  value: unknown,
  target?: WorkspaceResourceVoiceoverTaskTarget,
): NormalizedWorkspaceResourceVoiceoverMixTaskPayload {
  const parsed = mixTaskEnvelope.parse(value)
  const payload = workspaceResourceVoiceoverMixTaskPayloadSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    protocol: parsed.protocol,
    resource: parsed.resource,
  })
  validateTaskTarget(payload.resource.resourceId, target)
  const source = payload.resource.inputs.find((input) => input.role === 'source_video')
  const reference = payload.resource.inputs.find((input) => input.role === 'reference_audio')
  if (!source || !reference) throw new Error('VOICEOVER_MIX_INPUT_NORMALIZATION_FAILED')
  const narrations = payload.resource.inputs
    .filter((input) => input.role === 'voiceover_audio')
    .sort((left, right) => left.position - right.position)
  const bgm = payload.resource.inputs.find((input) => input.role === 'bgm_audio')
  return {
    ...payload,
    resourceFacts: {
      ...payload.resource,
      workspacePath: null,
      sourceTurnId: null,
    },
    inputAggregate: {
      source,
      reference,
      narrations,
      ...(bgm ? { bgm } : {}),
    },
  }
}
