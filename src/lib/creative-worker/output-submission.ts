import { z } from 'zod'
import { CreativeWorkerError } from './errors'
import {
  buildCreativeWorkerSubmissionToolSchema,
  normalizeCreativeWorkerSubmissionOutput,
  type CreativeWorkerSubmissionToolSchema,
} from './submission-transport'
import type {
  CreativeWorkOutput,
  CreativeWorkOutputDefinition,
} from './output-registry'
import type {
  CreativeWorkOutputKind,
  CreativeWorkRequest,
} from './types'

type JsonRecord = Record<string, unknown>

export const creativeWorkerSubmissionIssueSchema = z.object({
  path: z.string().trim().min(1).max(1_000),
  code: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
}).strict()

export type CreativeWorkerSubmissionIssue = z.infer<typeof creativeWorkerSubmissionIssueSchema>

export const creativeWorkerSubmissionInputDiagnosticSchema = z.object({
  inputType: z.enum([
    'undefined',
    'null',
    'object',
    'array',
    'string',
    'number',
    'boolean',
  ]),
  rawArgumentChars: z.number().int().nonnegative(),
  topLevelKeyCount: z.number().int().nonnegative(),
  topLevelKeys: z.array(z.string().max(200)).max(64),
}).strict()

export type CreativeWorkerSubmissionInputDiagnostic = z.infer<
  typeof creativeWorkerSubmissionInputDiagnosticSchema
>

export type CreativeWorkerSubmissionResult =
  | {
      readonly accepted: true
      readonly outputKind: CreativeWorkOutputKind
      readonly outputChars: number
    }
  | {
      readonly accepted: false
      readonly code: 'CREATIVE_WORK_OUTPUT_INVALID'
      readonly instruction: string
      readonly issues: readonly CreativeWorkerSubmissionIssue[]
      readonly outputChars: number
      readonly inputDiagnostic: CreativeWorkerSubmissionInputDiagnostic
    }

function readJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((current, segment) => (
    typeof segment === 'number'
      ? `${current}[${String(segment)}]`
      : `${current}.${String(segment)}`
  ), '$')
}

function normalizeIssue(issue: z.core.$ZodIssue): CreativeWorkerSubmissionIssue {
  return {
    path: formatIssuePath(issue.path),
    code: issue.code,
    message: issue.message.slice(0, 500),
  }
}

// Deterministic score-cue validation. The model claims nothing here: cue
// prompt budgets, durations, ordering and count are counted in code against
// the injected music production context (the configured model's wire limits).
function validateMusicOutputContext(input: {
  readonly request: CreativeWorkRequest
  readonly output: CreativeWorkOutput
}): readonly CreativeWorkerSubmissionIssue[] {
  if (input.output.kind !== 'music_direction') return []
  const production = input.request.productionContext.music
  if (!production) {
    throw new CreativeWorkerError('CREATIVE_WORK_REQUEST_INVALID', {
      outputKind: input.output.kind,
      reason: 'music production context is required',
    })
  }
  const issues: CreativeWorkerSubmissionIssue[] = []
  if (input.output.cues.length > production.maxCues) {
    issues.push({
      path: '$.cues',
      code: 'too_big',
      message: `At most ${String(production.maxCues)} cues are allowed; got ${String(input.output.cues.length)}.`,
    })
  }
  let previousEnd = -1
  input.output.cues.forEach((cue, index) => {
    if (cue.generationPrompt.length > production.promptMaxCharacters) {
      issues.push({
        path: `$.cues[${String(index)}].generationPrompt`,
        code: 'too_big',
        message: `Cue prompt is ${String(cue.generationPrompt.length)} characters; the music model accepts at most ${String(production.promptMaxCharacters)}.`,
      })
    }
    const durationSeconds = cue.endSeconds - cue.startSeconds
    if (
      durationSeconds < production.minCueDurationSeconds
      || durationSeconds > production.maxCueDurationSeconds
    ) {
      issues.push({
        path: `$.cues[${String(index)}]`,
        code: 'invalid_value',
        message: `Cue duration ${durationSeconds.toFixed(3)}s is outside the model range ${String(production.minCueDurationSeconds)}-${String(production.maxCueDurationSeconds)}s.`,
      })
    }
    if (cue.startSeconds < previousEnd) {
      issues.push({
        path: `$.cues[${String(index)}].startSeconds`,
        code: 'invalid_value',
        message: 'Cues must be ordered by startSeconds and must not overlap.',
      })
    }
    previousEnd = Math.max(previousEnd, cue.endSeconds)
  })
  return issues
}

function validateVideoOutputContext(input: {
  readonly request: CreativeWorkRequest
  readonly output: CreativeWorkOutput
}): readonly CreativeWorkerSubmissionIssue[] {
  if (input.output.kind !== 'video_prompt_set') return []
  const production = input.request.productionContext.video
  const durationIntent = input.request.durationIntent
  if (!production || durationIntent === undefined) {
    throw new CreativeWorkerError('CREATIVE_WORK_REQUEST_INVALID', {
      outputKind: input.output.kind,
      reason: 'video production context and duration intent are required',
    })
  }

  const issues: CreativeWorkerSubmissionIssue[] = []
  const allowedDurations = new Set(production.allowedSegmentDurationsSeconds)
  const mediaSources = input.request.context.sourceMaterials.filter((source) => (
    source.provenance.kind === 'resource'
    && (source.kind === 'image' || source.kind === 'audio')
  ))
  const mediaByResourceId = new Map(
    mediaSources.map((source) => [source.provenance.kind === 'resource'
      ? source.provenance.resourceId
      : '', source] as const),
  )
  if (mediaByResourceId.size !== mediaSources.length) {
    throw new CreativeWorkerError('CREATIVE_WORK_REQUEST_INVALID', {
      outputKind: input.output.kind,
      reason: 'media source resource IDs must be unique',
    })
  }
  const segmentKeys = new Set<string>()
  let totalDurationSeconds = 0
  input.output.segments.forEach((segment, index) => {
    if (segmentKeys.has(segment.key)) {
      issues.push({
        path: `$.segments[${String(index)}].key`,
        code: 'duplicate',
        message: `Segment key "${segment.key}" is duplicated.`,
      })
    }
    segmentKeys.add(segment.key)
    const segmentResourceIds = new Set<string>()
    let imageCount = 0
    let audioCount = 0
    segment.mediaResourceIds.forEach((resourceId, resourceIndex) => {
      const path = `$.segments[${String(index)}].mediaResourceIds[${String(resourceIndex)}]`
      if (segmentResourceIds.has(resourceId)) {
        issues.push({
          path,
          code: 'duplicate',
          message: `Resource "${resourceId}" is duplicated in this segment.`,
        })
        return
      }
      segmentResourceIds.add(resourceId)
      const source = mediaByResourceId.get(resourceId)
      if (!source) {
        issues.push({
          path,
          code: 'unknown_resource',
          message: `Resource "${resourceId}" is not an image or audio source material in this frozen task.`,
        })
        return
      }
      if (source.kind === 'image') imageCount += 1
      if (source.kind === 'audio') audioCount += 1
    })
    if (imageCount > production.maxReferenceImages) {
      issues.push({
        path: `$.segments[${String(index)}].mediaResourceIds`,
        code: 'too_many_images',
        message: `Use at most ${String(production.maxReferenceImages)} image Resources.`,
      })
    }
    if (audioCount > production.maxReferenceAudios) {
      issues.push({
        path: `$.segments[${String(index)}].mediaResourceIds`,
        code: 'too_many_audios',
        message: `Use at most ${String(production.maxReferenceAudios)} audio Resources.`,
      })
    }
    if (audioCount > 0 && imageCount === 0) {
      issues.push({
        path: `$.segments[${String(index)}].mediaResourceIds`,
        code: 'audio_requires_image',
        message: 'Audio-conditioned video requires at least one image Resource in the same segment.',
      })
    }
    if (!allowedDurations.has(segment.durationSeconds)) {
      issues.push({
        path: `$.segments[${String(index)}].durationSeconds`,
        code: 'unsupported_value',
        message: `Use one of these configured durations: ${production.allowedSegmentDurationsSeconds.join(', ')}.`,
      })
    }
    totalDurationSeconds += segment.durationSeconds
  })
  if (durationIntent.mode === 'fixed' && totalDurationSeconds !== durationIntent.seconds) {
    issues.push({
      path: '$.segments',
      code: 'duration_total_mismatch',
      message: `Segment durations total ${String(totalDurationSeconds)} seconds; they must total exactly ${String(durationIntent.seconds)} seconds.`,
    })
  }
  return issues
}

export function buildCreativeWorkerCanonicalOutputSchema(input: {
  readonly kind: CreativeWorkOutputKind
  readonly schema: z.ZodObject
}): JsonRecord {
  const generated = z.toJSONSchema(input.schema, { target: 'draft-7' })
  const root = readJsonRecord(generated)
  if (!root || root.type !== 'object') {
    throw new Error(`CREATIVE_WORK_OUTPUT_SCHEMA_ROOT_INVALID:${input.kind}`)
  }
  return root
}

function rejectedSubmission(
  issues: readonly CreativeWorkerSubmissionIssue[],
  outputChars: number,
  inputDiagnostic: CreativeWorkerSubmissionInputDiagnostic,
): CreativeWorkerSubmissionResult {
  return {
    accepted: false,
    code: 'CREATIVE_WORK_OUTPUT_INVALID',
    instruction: 'Correct every listed issue and call submit_result again in this same run.',
    issues,
    outputChars,
    inputDiagnostic,
  }
}

function describeSubmissionInput(input: {
  readonly output: unknown
  readonly rawArguments: string
}): CreativeWorkerSubmissionInputDiagnostic {
  const output = input.output
  const inputType = output === undefined
    ? 'undefined'
    : output === null
      ? 'null'
      : Array.isArray(output)
        ? 'array'
        : typeof output
  const record = readJsonRecord(output)
  const keys = record ? Object.keys(record) : []
  return creativeWorkerSubmissionInputDiagnosticSchema.parse({
    inputType,
    rawArgumentChars: input.rawArguments.length,
    topLevelKeyCount: keys.length,
    topLevelKeys: keys.slice(0, 64).map((key) => key.slice(0, 200)),
  })
}

export type CreativeWorkerOutputSubmission = {
  readonly canonicalSchema: JsonRecord
  readonly toolSchema: CreativeWorkerSubmissionToolSchema
  readonly reject: (
    output: unknown,
    rawArguments: string,
    issues: readonly CreativeWorkerSubmissionIssue[],
  ) => CreativeWorkerSubmissionResult
  readonly submit: (
    output: unknown,
    rawArguments?: string,
  ) => CreativeWorkerSubmissionResult
  readonly readAcceptedOutput: () => CreativeWorkOutput | null
}

export function createCreativeWorkerOutputSubmission(input: {
  readonly request: CreativeWorkRequest
  readonly definition: CreativeWorkOutputDefinition
  readonly maxOutputChars: number
}): CreativeWorkerOutputSubmission {
  let acceptedOutput: CreativeWorkOutput | null = null
  const canonicalSchema = buildCreativeWorkerCanonicalOutputSchema({
    kind: input.request.outputKind,
    schema: input.definition.schema,
  })
  const toolSchema = buildCreativeWorkerSubmissionToolSchema({
    kind: input.request.outputKind,
    schema: input.definition.schema,
  })

  const measureOutput = (output: unknown): number => {
    const serialized = JSON.stringify(output)
    return serialized?.length ?? 0
  }

  return {
    canonicalSchema,
    toolSchema,
    reject: (output, rawArguments, issues) => rejectedSubmission(
      issues,
      measureOutput(output),
      describeSubmissionInput({ output, rawArguments }),
    ),
    submit: (submittedOutput, rawArguments = JSON.stringify(submittedOutput) ?? '') => {
      const outputChars = measureOutput(submittedOutput)
      const inputDiagnostic = describeSubmissionInput({
        output: submittedOutput,
        rawArguments,
      })
      if (acceptedOutput) {
        return rejectedSubmission([{
          path: '$',
          code: 'already_accepted',
          message: 'A valid result has already been accepted for this run.',
        }], outputChars, inputDiagnostic)
      }
      if (outputChars > input.maxOutputChars) {
        return rejectedSubmission([{
          path: '$',
          code: 'too_big',
          message: `Serialized output exceeds the ${String(input.maxOutputChars)} character limit.`,
        }], outputChars, inputDiagnostic)
      }

      const normalizedOutput = normalizeCreativeWorkerSubmissionOutput({
        schema: input.definition.schema,
        value: submittedOutput,
      })
      const parsed = input.definition.schema.safeParse(normalizedOutput)
      if (!parsed.success) {
        return rejectedSubmission(
          parsed.error.issues.slice(0, 64).map(normalizeIssue),
          outputChars,
          inputDiagnostic,
        )
      }
      const output = parsed.data as CreativeWorkOutput
      if (output.kind !== input.request.outputKind) {
        return rejectedSubmission([{
          path: '$.kind',
          code: 'invalid_value',
          message: `Expected output kind "${input.request.outputKind}".`,
        }], outputChars, inputDiagnostic)
      }
      const contextualIssues = [
        ...validateVideoOutputContext({ request: input.request, output }),
        ...validateMusicOutputContext({ request: input.request, output }),
      ]
      if (contextualIssues.length > 0) {
        return rejectedSubmission(contextualIssues, outputChars, inputDiagnostic)
      }

      acceptedOutput = output
      return {
        accepted: true,
        outputKind: output.kind,
        outputChars,
      }
    },
    readAcceptedOutput: () => acceptedOutput,
  }
}
