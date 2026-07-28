import { z } from 'zod'
import { CreativeWorkerError } from './errors'
import type {
  CreativeWorkOutput,
  CreativeWorkOutputDefinition,
} from './output-registry'
import type {
  CreativeWorkOutputKind,
  CreativeWorkRequest,
} from './types'

type JsonRecord = Record<string, unknown>

export type CreativeWorkerSubmissionIssue = {
  readonly path: string
  readonly code: string
  readonly message: string
}

export class CreativeWorkerSubmissionValidationError extends Error {
  readonly issues: readonly CreativeWorkerSubmissionIssue[]

  constructor(issues: readonly CreativeWorkerSubmissionIssue[]) {
    super('CREATIVE_WORK_OUTPUT_INVALID')
    this.name = 'CreativeWorkerSubmissionValidationError'
    this.issues = issues
  }
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

export function formatCreativeWorkerSubmissionError(error: unknown): string {
  if (!(error instanceof CreativeWorkerSubmissionValidationError)) throw error
  return JSON.stringify({
    accepted: false,
    code: 'CREATIVE_WORK_OUTPUT_INVALID',
    instruction: 'Correct every listed issue and call submit_result again in this same run.',
    issues: error.issues,
  })
}

export type CreativeWorkerOutputSubmission = {
  readonly canonicalSchema: JsonRecord
  readonly submit: (outputJson: string) => {
    readonly accepted: true
    readonly outputKind: CreativeWorkOutputKind
  }
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

  return {
    canonicalSchema,
    submit: (outputJson) => {
      if (acceptedOutput) {
        throw new CreativeWorkerSubmissionValidationError([{
          path: '$',
          code: 'already_accepted',
          message: 'A valid result has already been accepted for this run.',
        }])
      }
      if (outputJson.length > input.maxOutputChars) {
        throw new CreativeWorkerSubmissionValidationError([{
          path: '$',
          code: 'too_big',
          message: `Serialized output exceeds the ${String(input.maxOutputChars)} character limit.`,
        }])
      }

      let raw: unknown
      try {
        raw = JSON.parse(outputJson) as unknown
      } catch {
        throw new CreativeWorkerSubmissionValidationError([{
          path: '$',
          code: 'invalid_json',
          message: 'outputJson must contain one complete valid JSON value.',
        }])
      }

      const parsed = input.definition.schema.safeParse(raw)
      if (!parsed.success) {
        throw new CreativeWorkerSubmissionValidationError(
          parsed.error.issues.slice(0, 64).map(normalizeIssue),
        )
      }
      const output = parsed.data as CreativeWorkOutput
      if (output.kind !== input.request.outputKind) {
        throw new CreativeWorkerSubmissionValidationError([{
          path: '$.kind',
          code: 'invalid_value',
          message: `Expected output kind "${input.request.outputKind}".`,
        }])
      }
      const contextualIssues = validateVideoOutputContext({
        request: input.request,
        output,
      })
      if (contextualIssues.length > 0) {
        throw new CreativeWorkerSubmissionValidationError(contextualIssues)
      }

      acceptedOutput = output
      return {
        accepted: true,
        outputKind: output.kind,
      }
    },
    readAcceptedOutput: () => acceptedOutput,
  }
}
