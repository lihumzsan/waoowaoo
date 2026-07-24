import type {
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceRevisionContent,
} from './contracts'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker/task-contract'
import { readCreativeWorkOutputDefinition } from '@/lib/creative-worker/output-registry'
import { CREATIVE_RESOURCE_SCHEMA } from './schema-registry'
import {
  compileAssetManifest,
  screenplaySchema,
} from '@/lib/screenplay'
import { creativeStyleBibleSchema } from '@/lib/creative-style/contracts'

export interface CreativeWorkResourceMaterializationPlan {
  readonly resourceScope: 'project' | 'episode'
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
    | typeof CREATIVE_RESOURCE_SCHEMA.SCREENPLAY
    | typeof CREATIVE_RESOURCE_SCHEMA.STORY_CANON
    | typeof CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN
    | typeof CREATIVE_RESOURCE_SCHEMA.CONTINUITY_ANALYSIS
    | typeof CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE
    | typeof CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST
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
      revisionId: source.provenance.revisionId,
      role: 'source_material',
      position: inputs.length,
    })
  }
  return inputs
}

function parseStructuredSourceMaterials(
  payload: ReturnType<typeof creativeWorkTaskPayloadSchema.parse>,
): readonly {
  readonly revisionId: string
  readonly value: unknown
}[] {
  return payload.request.context.sourceMaterials.flatMap((source) => {
    if (source.kind !== 'structured' || source.provenance.kind !== 'resource') return []
    try {
      return [{ revisionId: source.provenance.revisionId, value: JSON.parse(source.content) as unknown }]
    } catch {
      throw new Error(`CREATIVE_WORK_STRUCTURED_SOURCE_INVALID:${source.provenance.revisionId}`)
    }
  })
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

  const output = result.creativeWorkResult.output
  const common = {
    resourceScope: readCreativeWorkOutputDefinition(output.kind).resourceScope,
    inputFingerprint: payload.inputFingerprint,
    prompt: payload.request.goal,
    modelKey: payload.modelKey,
    toolCallId: payload.origin.toolCallId,
    inputs: resourceInputsFromPayload(payload),
  }
  if (output.kind === 'screenplay') {
    const screenplay = screenplaySchema.parse(output)
    return {
      ...common,
      outputs: [{
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        sourceType: 'CreativeWorkResult',
        sourceId: input.taskId,
        name: truncateResourceName(output.title),
        candidateSetId: null,
        candidateIndex: null,
        candidateKey: null,
        content: { kind: 'structured', data: toCreativeJson(screenplay) },
        generationOptions: toCreativeJson({
          outputKind: output.kind,
          requestKey: payload.requestKey,
          source: screenplay.source,
        }),
      }],
    }
  }
  if (output.kind === 'story_canon') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.STORY_CANON,
      name: output.bundle.storyCanon.title
        || output.bundle.storyCanon.logline
        || 'Story Canon',
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
  if (output.kind === 'asset_manifest') {
    const structuredSources = parseStructuredSourceMaterials(payload)
    const screenplaySources = structuredSources.flatMap((source) => {
      const parsed = screenplaySchema.safeParse(source.value)
      return parsed.success ? [{ revisionId: source.revisionId, screenplay: parsed.data }] : []
    })
    const styleSources = structuredSources.flatMap((source) => {
      const parsed = creativeStyleBibleSchema.safeParse(source.value)
      return parsed.success ? [{ revisionId: source.revisionId }] : []
    })
    if (screenplaySources.length !== 1) {
      throw new Error('ASSET_MANIFEST_SCREENPLAY_SOURCE_REQUIRED')
    }
    if (styleSources.length !== 1) {
      throw new Error('ASSET_MANIFEST_STYLE_BIBLE_SOURCE_REQUIRED')
    }
    const screenplaySource = screenplaySources[0]
    const styleSource = styleSources[0]
    if (!screenplaySource || !styleSource) throw new Error('ASSET_MANIFEST_SOURCE_REQUIRED')
    const manifest = compileAssetManifest({
      screenplay: screenplaySource.screenplay,
      manifest: output,
    })
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
      name: output.overview || 'Asset manifest',
      data: manifest,
      generationOptions: {
        outputKind: output.kind,
        requestKey: payload.requestKey,
        screenplayRevisionId: screenplaySource.revisionId,
        styleBibleRevisionId: styleSource.revisionId,
      },
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
  readonly resourceScope: 'project' | 'episode'
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
    resourceScope: input.resourceScope,
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
