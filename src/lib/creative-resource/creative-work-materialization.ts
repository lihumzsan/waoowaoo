import type {
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceContent,
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
    | typeof CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN
    | typeof CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION
    | typeof CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST
    | typeof CREATIVE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET
    | typeof CREATIVE_RESOURCE_SCHEMA.MUSIC_DIRECTION
  readonly sourceType: 'CreativeWorkResult'
  readonly sourceId: string
  readonly name: string
  readonly candidateSetId: string | null
  readonly candidateIndex: number | null
  readonly content: CreativeResourceContent
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
      role: 'source_material',
      position: inputs.length,
    })
  }
  if (payload.request.creativeDirection) {
    inputs.push({
      resourceId: payload.request.creativeDirection.resourceId,
      role: 'creative_direction',
      position: inputs.length,
    })
  }
  return inputs
}

function parseStructuredSourceMaterials(
  payload: ReturnType<typeof creativeWorkTaskPayloadSchema.parse>,
): readonly {
  readonly resourceId: string
  readonly value: unknown
}[] {
  return payload.request.context.sourceMaterials.flatMap((source) => {
    if (source.kind !== 'structured' || source.provenance.kind !== 'resource') return []
    try {
      return [{ resourceId: source.provenance.resourceId, value: JSON.parse(source.content) as unknown }]
    } catch {
      throw new Error(`CREATIVE_WORK_STRUCTURED_SOURCE_INVALID:${source.provenance.resourceId}`)
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
        content: { kind: 'structured', data: toCreativeJson(screenplay) },
        generationOptions: toCreativeJson({
          outputKind: output.kind,
          requestKey: payload.requestKey,
          source: screenplay.source,
        }),
      }],
    }
  }
  if (output.kind === 'chapter_continuity_plan') {
    return structuredOutput({
      ...common,
      taskId: input.taskId,
      schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN,
      name: output.storyCanon.storyCanon.title
        || output.storyCanon.storyCanon.logline
        || 'Chapter continuity plan',
      data: output,
      generationOptions: {
        outputKind: output.kind,
        requestKey: payload.requestKey,
        assumptions: output.assumptions,
        warnings: output.warnings,
      },
    })
  }
  if (output.kind === 'asset_manifest') {
    const structuredSources = parseStructuredSourceMaterials(payload)
    const screenplaySources = structuredSources.flatMap((source) => {
      const parsed = screenplaySchema.safeParse(source.value)
      return parsed.success ? [{ resourceId: source.resourceId }] : []
    })
    if (screenplaySources.length !== 1) {
      throw new Error('ASSET_MANIFEST_SCREENPLAY_SOURCE_REQUIRED')
    }
    const screenplaySource = screenplaySources[0]
    if (!screenplaySource) throw new Error('ASSET_MANIFEST_SOURCE_REQUIRED')
    const manifest = compileAssetManifest({
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
        screenplayResourceId: screenplaySource.resourceId,
        creativeDirectionResourceId: payload.request.creativeDirection?.resourceId ?? null,
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
  if (output.kind !== 'creative_direction') {
    const unreachable: never = output
    throw new Error(`CREATIVE_WORK_RESOURCE_OUTPUT_UNMAPPED:${String(unreachable)}`)
  }
  return {
    ...common,
    outputs: [{
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
      sourceType: 'CreativeWorkResult',
      sourceId: input.taskId,
      name: truncateResourceName(output.creativeDirection.styleSummary),
      candidateSetId: null,
      candidateIndex: null,
      content: {
        kind: 'structured',
        data: toCreativeJson(output.creativeDirection),
      },
      generationOptions: toCreativeJson({
        outputKind: output.kind,
        requestKey: payload.requestKey,
        assumptions: output.assumptions,
        warnings: output.warnings,
        research: result.creativeWorkResult.research,
      }),
    }],
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
      content: { kind: 'structured', data: toCreativeJson(input.data) },
      generationOptions: toCreativeJson(input.generationOptions),
    }],
  }
}
