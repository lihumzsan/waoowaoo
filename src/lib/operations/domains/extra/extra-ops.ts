import { z } from 'zod'
import { createHash } from 'crypto'
import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { getProjectModelConfig } from '@/lib/config-service'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'

function parseReferenceImages(body: Record<string, unknown>): string[] {
  const list = Array.isArray(body.referenceImageUrls)
    ? body.referenceImageUrls.map((item: unknown) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : []
  if (list.length > 0) return list.slice(0, 5)
  const single = typeof body.referenceImageUrl === 'string' ? body.referenceImageUrl.trim() : ''
  return single ? [single] : []
}

const EFFECTS_BILLABLE_LONG_RUNNING = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: true,
  longRunning: true,
} as const

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assertNoLegacyArtStyle(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

export function createExtraOperations(): ProjectAgentOperationRegistryDraft {
  return {
    ai_create_character: defineOperation({
      id: 'ai_create_character',
      summary: 'Submit AI create character design task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        userInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const userInstruction = input.userInstruction.trim()
        const modelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
        if (!modelConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }
        const dedupeDigest = createHash('sha1')
          .update(`${ctx.projectId}:${ctx.userId}:character:${userInstruction}`)
          .digest('hex')
          .slice(0, 16)

        const payload = {
          userInstruction,
          analysisModel: modelConfig.analysisModel,
          displayMode: 'detail',
        }

        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_CREATE_CHARACTER,
          targetType: 'ProjectCharacterDesign',
          targetId: ctx.projectId,
          operationId: 'ai_create_character',
          source: ctx.source,
          payload,
          dedupeKey: `project_ai_create_character:${dedupeDigest}`,
        })
      },
    }),
    ai_create_location: defineOperation({
      id: 'ai_create_location',
      summary: 'Submit AI create location design task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        userInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const userInstruction = input.userInstruction.trim()
        const modelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
        if (!modelConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }
        const dedupeDigest = createHash('sha1')
          .update(`${ctx.projectId}:${ctx.userId}:location:${userInstruction}`)
          .digest('hex')
          .slice(0, 16)

        const payload = {
          userInstruction,
          analysisModel: modelConfig.analysisModel,
          displayMode: 'detail',
        }

        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_CREATE_LOCATION,
          targetType: 'ProjectLocationDesign',
          targetId: ctx.projectId,
          operationId: 'ai_create_location',
          source: ctx.source,
          payload,
          dedupeKey: `project_ai_create_location:${dedupeDigest}`,
        })
      },
    }),
    ai_modify_location: defineOperation({
      id: 'ai_modify_location',
      summary: 'Submit AI modify location task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        locationId: z.string().min(1),
        imageIndex: z.number().int().min(0).optional(),
        currentDescription: z.string().min(1),
        modifyInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const imageIndex = input.imageIndex ?? 0
        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_MODIFY_LOCATION,
          targetType: 'ProjectLocation',
          targetId: input.locationId,
          operationId: 'ai_modify_location',
          source: ctx.source,
          payload: {
            ...input,
            imageIndex,
          } as unknown as Record<string, unknown>,
          dedupeKey: `ai_modify_location:${input.locationId}:${imageIndex}`,
        })
      },
    }),
    reference_to_character: defineOperation({
      id: 'reference_to_character',
      summary: 'Submit reference-to-character task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const body = input as unknown as Record<string, unknown>
        assertNoLegacyArtStyle(body)
        const referenceImages = parseReferenceImages(body)
        if (referenceImages.length === 0) {
          throw new ApiError('INVALID_PARAMS')
        }
        const count = normalizeImageGenerationCount('reference-to-character', body.count)
        body.count = count

        const isBackgroundJob = body.isBackgroundJob === true || body.isBackgroundJob === 1 || body.isBackgroundJob === '1'
        const characterId = typeof body.characterId === 'string' ? body.characterId : ''
        const appearanceId = typeof body.appearanceId === 'string' ? body.appearanceId : ''
        if (isBackgroundJob && (!characterId || !appearanceId)) {
          throw new ApiError('INVALID_PARAMS')
        }

        const targetType = appearanceId ? 'CharacterAppearance' : 'Project'
        const targetId = appearanceId || characterId || ctx.projectId
        const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
          projectId: ctx.projectId,
          episodeId: normalizeString(body.episodeId) || null,
        })

        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.REFERENCE_TO_CHARACTER,
          targetType,
          targetId,
          operationId: 'reference_to_character',
          source: ctx.source,
          payload: body,
          dedupeKey: `reference_to_character:${targetId}:${count}:${styleBibleSignature}`,
        })
      },
    }),
  }
}
