import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { bindCreativeResourceRevisionInTransaction } from '@/lib/creative-resource/binding-service'
import {
  appendCreativeResourceRevisionInTransaction,
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  CREATIVE_RESOURCE_SCHEMA,
  reserveDomainCreativeResourceInTransaction,
  resolveProjectCreativeResourceScope,
  type CreativeResourceInputRef,
  type CreativeResourceJsonValue,
} from '@/lib/creative-resource'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const adoptStyleBibleInputSchema = z.object({
  taskId: z.string().trim().min(1)
    .describe('Exact completed creative_work Task whose strict style_bible result contains the final design or candidate being adopted.'),
  name: z.string().trim().min(1).max(300)
    .describe('User-facing Resource name in the current conversation language.'),
  selection: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('final'),
    }).strict(),
    z.object({
      kind: z.literal('candidate'),
      styleKey: z.enum(['style_a', 'style_b', 'style_c'])
        .describe('Exact candidate key returned by the completed style_bible Task.'),
    }).strict(),
  ]).describe('Adopt the Task final result, or one exact text-first candidate from the same persisted Task result.'),
  expectedVersion: z.number().int().min(0).nullable().optional()
    .describe('Pass null for the first adoption; pass the current canonical style binding version when replacing an adopted Style Bible.'),
}).strict()

const adoptStyleBibleOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
  schemaId: z.literal(CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE),
  binding: z.object({
    bindingId: z.string().trim().min(1),
    scope: z.object({
      kind: z.enum(['user', 'project', 'episode']),
      id: z.string().trim().min(1),
      userId: z.string().trim().min(1),
      projectId: z.string().trim().min(1).nullable(),
      episodeId: z.string().trim().min(1).nullable(),
    }).strict(),
    role: z.literal(CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedStyleBible.role),
    slotKey: z.literal(CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedStyleBible.slotKey),
    resourceId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    version: z.number().int().min(0),
    source: z.string().trim().min(1),
  }).strict(),
}).strict()

function toCreativeJson(value: unknown): CreativeResourceJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CREATIVE_STYLE_BIBLE_JSON_NUMBER_INVALID')
    return value
  }
  if (Array.isArray(value)) return value.map(toCreativeJson)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toCreativeJson(entry)]))
  }
  throw new Error('CREATIVE_STYLE_BIBLE_JSON_VALUE_INVALID')
}

function resourceInputsFromTask(
  payload: z.infer<typeof creativeWorkTaskPayloadSchema>,
): CreativeResourceInputRef[] {
  const inputs: CreativeResourceInputRef[] = []
  for (const source of payload.request.context.sourceMaterials) {
    if (source.provenance.kind !== 'resource') continue
    inputs.push({
      resourceId: source.provenance.resourceId,
      revisionId: source.provenance.revisionId,
      fingerprint: source.provenance.fingerprint,
      role: 'style_source',
      position: inputs.length,
    })
  }
  return inputs
}

export function createAssistantCreativeStyleOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_style_bible: defineOperation({
      id: 'adopt_style_bible',
      summary: 'Adopt either the final result or one exact text-first candidate from a completed style_bible Creative Task as the canonical structured Style Bible Resource. This selection creates one immutable final revision and updates its reserved Binding in the same transaction.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: adoptStyleBibleInputSchema,
      outputSchema: adoptStyleBibleOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const task = await transaction.task.findFirst({
          where: {
            id: input.taskId,
            userId: context.userId,
            projectId: context.projectId,
            type: TASK_TYPE.CREATIVE_WORK,
          },
          select: {
            id: true,
            episodeId: true,
            status: true,
            payload: true,
            result: true,
          },
        })
        if (!task) {
          throw new ApiError('NOT_FOUND', {
            code: 'CREATIVE_STYLE_BIBLE_TASK_NOT_FOUND',
            field: 'taskId',
          })
        }
        if (task.status !== TASK_STATUS.COMPLETED) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_STYLE_BIBLE_TASK_NOT_COMPLETED',
            field: 'taskId',
            requestedValue: task.status,
            allowedValues: [TASK_STATUS.COMPLETED],
            agentRetryableAfterCorrection: true,
          })
        }
        const payload = creativeWorkTaskPayloadSchema.parse(task.payload)
        const result = creativeWorkTaskResultSchema.parse(task.result)
        if (
          payload.request.outputKind !== 'style_bible'
          || result.outputKind !== 'style_bible'
          || result.creativeWorkResult.outputKind !== 'style_bible'
          || result.creativeWorkResult.output.kind !== 'style_bible'
        ) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_STYLE_BIBLE_TASK_OUTPUT_MISMATCH',
            field: 'taskId',
            agentRetryableAfterCorrection: true,
          })
        }
        const output = result.creativeWorkResult.output
        const selection = input.selection
        const selectedStyleBible = selection.kind === 'final'
          ? (() => {
              if (output.design.mode !== 'final') {
                throw new ApiError('INVALID_PARAMS', {
                  code: 'CREATIVE_STYLE_BIBLE_FINAL_RESULT_REQUIRED',
                  field: 'selection.kind',
                  requestedValue: output.design.mode,
                  allowedValues: ['candidate'],
                  agentRetryableAfterCorrection: true,
                })
              }
              return output.design.styleBible
            })()
          : (() => {
              if (output.design.mode !== 'candidates') {
                throw new ApiError('INVALID_PARAMS', {
                  code: 'CREATIVE_STYLE_BIBLE_CANDIDATE_RESULT_REQUIRED',
                  field: 'selection.kind',
                  requestedValue: output.design.mode,
                  allowedValues: ['final'],
                  agentRetryableAfterCorrection: true,
                })
              }
              const selected = output.design.options.stylePreviews.find(
                (candidate) => candidate.styleKey === selection.styleKey,
              )
              if (!selected) {
                throw new ApiError('INVALID_PARAMS', {
                  code: 'CREATIVE_STYLE_BIBLE_CANDIDATE_NOT_FOUND',
                  field: 'selection.styleKey',
                  requestedValue: selection.styleKey,
                  allowedValues: output.design.options.stylePreviews.map((candidate) => candidate.styleKey),
                  agentRetryableAfterCorrection: true,
                })
              }
              return selected.styleBible
            })()
        const scope = resolveProjectCreativeResourceScope({
          userId: context.userId,
          projectId: context.projectId,
          episodeId: task.episodeId,
        })
        const selectedSourceId = selection.kind === 'final'
          ? `${task.id}:final`
          : `${task.id}:${selection.styleKey}`
        const reserved = await reserveDomainCreativeResourceInTransaction(transaction, {
          scope,
          mediaType: 'text',
          schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
          sourceType: 'CreativeWorkStyleBible',
          sourceId: selectedSourceId,
          name: input.name,
        })
        const revision = await appendCreativeResourceRevisionInTransaction(transaction, {
          resourceId: reserved.resourceId,
          userId: context.userId,
          mediaType: 'text',
          schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
          content: {
            kind: 'structured',
            data: toCreativeJson(selectedStyleBible),
          },
          inputs: resourceInputsFromTask(payload),
          provenance: {
            operationId: 'adopt_style_bible',
            inputHash: stableArgsHash({
              taskInputFingerprint: payload.inputFingerprint,
              selection,
            }),
            taskId: task.id,
            operationExecutionId: context.executionAuthorization?.operationExecutionId ?? null,
            executionSegmentId: context.executionFence?.concurrentExecutionSegmentId ?? null,
            toolCallId: context.toolCallId ?? null,
            prompt: payload.request.goal,
            modelKey: payload.modelKey,
            generationOptions: toCreativeJson({
              outputKind: payload.request.outputKind,
              selection,
              assumptions: output.assumptions,
              warnings: output.warnings,
            }),
          },
        })
        const binding = await bindCreativeResourceRevisionInTransaction(transaction, {
          scope,
          ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedStyleBible,
          resourceId: reserved.resourceId,
          revisionId: revision.revisionId,
          source: 'style_adoption',
          expectedVersion: input.expectedVersion ?? null,
        })
        return adoptStyleBibleOutputSchema.parse({
          success: true,
          ...revision,
          schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
          binding,
        })
      },
    }),
  }
}
