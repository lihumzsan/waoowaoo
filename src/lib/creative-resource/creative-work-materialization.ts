import type {
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceRevisionContent,
} from './contracts'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker/task-contract'
import { CREATIVE_RESOURCE_SCHEMA } from './schema-registry'

export interface CreativeWorkResourceMaterializationPlan {
  readonly inputFingerprint: string
  readonly prompt: string
  readonly modelKey: string
  readonly toolCallId: string
  readonly inputs: readonly CreativeResourceInputRef[]
  readonly outputs: readonly CreativeWorkResourceMaterializationOutput[]
}

export interface CreativeWorkResourceMaterializationOutput {
  readonly mediaType: 'text'
  readonly schemaId:
    | typeof CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT
    | typeof CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE
    | typeof CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN
    | typeof CREATIVE_RESOURCE_SCHEMA.CONTINUITY_ANALYSIS
    | typeof CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE
    | typeof CREATIVE_RESOURCE_SCHEMA.ASSET_PROMPT_SET
    | typeof CREATIVE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET
    | typeof CREATIVE_RESOURCE_SCHEMA.MUSIC_DIRECTION
    | typeof CREATIVE_RESOURCE_SCHEMA.CREATIVE_REVIEW
  readonly sourceType: 'CreativeWorkResult'
  readonly sourceId: string
  readonly name: string
  readonly candidateSetId: string | null
  readonly candidateIndex: number | null
  readonly candidateKey: string | null
  readonly content: CreativeResourceRevisionContent
  readonly generationOptions: CreativeResourceJsonValue
}

function toCreativeJson(value: unknown): CreativeResourceJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CREATIVE_WORK_RESOURCE_JSON_NUMBER_INVALID')
    return value
  }
  if (Array.isArray(value)) return value.map(toCreativeJson)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toCreativeJson(entry)]),
    )
  }
  throw new Error('CREATIVE_WORK_RESOURCE_JSON_VALUE_INVALID')
}

function truncateResourceName(value: string): string {
  return value.trim().slice(0, 191)
}

function resourceInputsFromPayload(
  payload: ReturnType<typeof creativeWorkTaskPayloadSchema.parse>,
): CreativeResourceInputRef[] {
  const inputs: CreativeResourceInputRef[] = []
  for (const source of payload.request.context.sourceMaterials) {
    if (source.provenance.kind !== 'resource') continue
    inputs.push({
      resourceId: source.provenance.resourceId,
      revisionId: source.provenance.revisionId,
      fingerprint: source.provenance.fingerprint,
      role: 'source_material',
      position: inputs.length,
    })
  }
  return inputs
}

export function planCreativeWorkResourceMaterialization(input: {
  readonly taskId: string
  readonly payload: unknown
  readonly result: unknown
}): CreativeWorkResourceMaterializationPlan {
  const payload = creativeWorkTaskPayloadSchema.parse(input.payload)
  const result = creativeWorkTaskResultSchema.parse(input.result)
  if (
    result.requestKey !== payload.requestKey
    || result.outputKind !== payload.request.outputKind
  ) {
    throw new Error(`CREATIVE_WORK_RESOURCE_RESULT_MISMATCH:${input.taskId}`)
  }

  const common = {
    inputFingerprint: payload.inputFingerprint,
    prompt: payload.request.goal,
    modelKey: payload.modelKey,
    toolCallId: payload.origin.toolCallId,
    inputs: resourceInputsFromPayload(payload),
  }
  const output = result.creativeWorkResult.output
  if (output.kind === 'screenplay_draft') {
    return {
      ...common,
      outputs: [{
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT,
        sourceType: 'CreativeWorkResult',
        sourceId: input.taskId,
        name: truncateResourceName(output.title),
        candidateSetId: null,
        candidateIndex: null,
        candidateKey: null,
        content: { kind: 'text', text: output.screenplay },
        generationOptions: toCreativeJson({
          outputKind: output.kind,
          requestKey: payload.requestKey,
          title: output.title,
          logline: output.logline,
          synopsis: output.synopsis,
          estimatedDurationSeconds: output.estimatedDurationSeconds,
          assumptions: output.assumptions,
          openQuestions: output.openQuestions,
        }),
      }],
    }
  }
  if (output.kind === 'edit_bible_bundle') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE,
      name: output.bundle.bible.title || output.bundle.bible.logline || 'Production Bible',
      data: output.bundle,
      generationOptions: {
        outputKind: output.kind,
        requestKey: payload.requestKey,
        assumptions: output.assumptions,
        warnings: output.warnings,
      },
    })
  }
  if (output.kind === 'chapter_plan') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN,
      name: 'Chapter plan',
      data: output,
      generationOptions: {
        outputKind: output.kind,
        requestKey: payload.requestKey,
        assumptions: output.assumptions,
        warnings: output.warnings,
      },
    })
  }
  if (output.kind === 'continuity_analysis') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.CONTINUITY_ANALYSIS,
      name: 'Continuity analysis',
      data: output,
      generationOptions: { outputKind: output.kind, requestKey: payload.requestKey },
    })
  }
  if (output.kind === 'asset_prompt_set') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.ASSET_PROMPT_SET,
      name: output.overview || 'Asset prompt set',
      data: output,
      generationOptions: { outputKind: output.kind, requestKey: payload.requestKey },
    })
  }
  if (output.kind === 'video_prompt_set') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET,
      name: 'Video prompt set',
      data: output,
      generationOptions: { outputKind: output.kind, requestKey: payload.requestKey },
    })
  }
  if (output.kind === 'music_direction') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.MUSIC_DIRECTION,
      name: output.overview,
      data: output,
      generationOptions: { outputKind: output.kind, requestKey: payload.requestKey },
    })
  }
  if (output.kind === 'creative_review') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_REVIEW,
      name: output.summary,
      data: output,
      generationOptions: { outputKind: output.kind, requestKey: payload.requestKey },
    })
  }
  if (output.kind !== 'style_bible') {
    const unreachable: never = output
    throw new Error(`CREATIVE_WORK_RESOURCE_OUTPUT_UNMAPPED:${String(unreachable)}`)
  }
  if (output.design.mode === 'final') {
    return {
      ...common,
      outputs: [{
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
        sourceType: 'CreativeWorkResult',
        sourceId: `${input.taskId}:final`,
        name: truncateResourceName(output.design.styleBible.styleSummary),
        candidateSetId: null,
        candidateIndex: null,
        candidateKey: null,
        content: {
          kind: 'structured',
          data: toCreativeJson(output.design.styleBible),
        },
        generationOptions: toCreativeJson({
          outputKind: output.kind,
          requestKey: payload.requestKey,
          mode: output.design.mode,
          assumptions: output.assumptions,
          warnings: output.warnings,
        }),
      }],
    }
  }
  return {
    ...common,
    outputs: output.design.candidates.map((candidate, candidateIndex) => ({
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
      sourceType: 'CreativeWorkResult',
      sourceId: `${input.taskId}:candidate:${candidate.candidateKey}`,
      name: truncateResourceName(candidate.title),
      candidateSetId: input.taskId,
      candidateIndex,
      candidateKey: candidate.candidateKey,
      content: {
        kind: 'structured',
        data: toCreativeJson(candidate.styleBible),
      },
      generationOptions: toCreativeJson({
        outputKind: output.kind,
        requestKey: payload.requestKey,
        mode: output.design.mode,
        candidateKey: candidate.candidateKey,
        title: candidate.title,
        summary: candidate.summary,
        assumptions: output.assumptions,
        warnings: output.warnings,
      }),
    })),
  }
}

function structuredOutput(input: {
  readonly inputFingerprint: string
  readonly prompt: string
  readonly modelKey: string
  readonly toolCallId: string
  readonly inputs: readonly CreativeResourceInputRef[]
  readonly taskId: string
  readonly schemaId: CreativeWorkResourceMaterializationOutput['schemaId']
  readonly name: string
  readonly data: unknown
  readonly generationOptions: unknown
}): CreativeWorkResourceMaterializationPlan {
  return {
    inputFingerprint: input.inputFingerprint,
    prompt: input.prompt,
    modelKey: input.modelKey,
    toolCallId: input.toolCallId,
    inputs: input.inputs,
    outputs: [{
      mediaType: 'text',
      schemaId: input.schemaId,
      sourceType: 'CreativeWorkResult',
      sourceId: input.taskId,
      name: truncateResourceName(input.name),
      candidateSetId: null,
      candidateIndex: null,
      candidateKey: null,
      content: { kind: 'structured', data: toCreativeJson(input.data) },
      generationOptions: toCreativeJson(input.generationOptions),
    }],
  }
}
