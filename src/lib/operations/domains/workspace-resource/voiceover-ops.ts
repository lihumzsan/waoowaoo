import { z } from 'zod'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import { resolveWorkspaceResourceInputs, resolveGeneratedWorkspaceResourcePlacement, reserveWorkspaceResourceInTransaction, createWorkspaceResourceFolderInTransaction } from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { workspaceResourceDisplayName } from '@/lib/workspace-resource/path'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { createPlannedTask, type OperationPlan, type PlannedTask } from '@/lib/operations/planning'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { submitPlannedOperationTasks } from '@/lib/operations/planning'
import { TASK_TYPE } from '@/lib/task/types'
import {
  buildWorkspaceResourceVoiceoverMixInputIdentity,
  buildWorkspaceResourceVoiceoverInputIdentity,
  parseWorkspaceResourceVoiceoverMixTaskPayload,
  parseWorkspaceResourceVoiceoverTaskPayload,
  workspaceResourceVoiceoverGenerationOptionsSchema,
  voiceoverLanguageSchema,
} from '@/lib/workspace-resource/voiceover-contract'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { refineTaskBatchSubmitOperationOutputSchema, taskBatchSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { preflightMediaGenerationOptions, preflightMediaProviderRoutes } from '@/lib/ai-exec/media-preflight'
import type { WorkspaceResourceVoiceoverMixTaskPayload } from '@/lib/workspace-resource/voiceover-contract'

const produceVoiceoverVideoInputSchema = z.object({
  folderPath: z.string().trim().min(1).max(512).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  video: z.object({ resourceId: z.string().trim().min(1), contentVersion: z.number().int().positive() }).strict(),
  referenceAudio: z.object({ resourceId: z.string().trim().min(1), contentVersion: z.number().int().positive() }).strict(),
  voiceovers: z.array(z.object({
    name: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(4096),
    language: voiceoverLanguageSchema,
    startSeconds: z.number().finite().nonnegative(),
  }).strict()).min(1).max(32),
  music: z.object({ resourceId: z.string().trim().min(1), contentVersion: z.number().int().positive() }).strict().optional(),
}).strict()

const produceVoiceoverVideoOutputSchema = refineTaskBatchSubmitOperationOutputSchema(taskBatchSubmitOperationOutputSchemaBase.extend({
  resourceId: z.string().min(1), workspacePath: z.string().min(1), narrationResourceIds: z.array(z.string().min(1)), mixTaskId: z.string().min(1),
}).passthrough())

type Input = z.infer<typeof produceVoiceoverVideoInputSchema>

export function createWorkspaceResourceVoiceoverOperations(): ProjectAgentOperationRegistryDraft {
  return {
    produce_voiceover_video: defineOperation({
      id: 'produce_voiceover_video',
      summary: 'Generate one cloned-speaker voiceover track per frozen narration and automatically mix it into one frozen video.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: { writes: true, workspaceResourceImpact: 'none', destructive: false, overwrite: false, bulk: true, externalSideEffects: true, longRunning: true },
      resourceContract: { kind: 'resource', assistantPresentation: 'created_resources', acceptsReferences: true, outputResourceKinds: ['file'], outputMediaTypes: ['audio', 'video'], outputSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO, WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO], placement: 'required' },
      confirmation: { kind: 'none', required: false },
      planContractRevision: 'produce_voiceover_video/v2',
      inputSchema: produceVoiceoverVideoInputSchema,
      outputSchema: produceVoiceoverVideoOutputSchema,
      plan: async (ctx, input): Promise<OperationPlan> => {
        const voiceModel = await resolveSystemModelKey({ userId: ctx.userId, projectId: ctx.projectId, purpose: 'voiceover' })
        const refs = await resolveWorkspaceResourceInputs(prisma, { userId: ctx.userId, projectId: ctx.projectId, references: [
          { ...input.video, role: 'source_video', position: 0 },
          { ...input.referenceAudio, role: 'reference_audio', position: 0 },
          ...(input.music ? [{ ...input.music, role: 'bgm_audio', position: 0 }] : []),
        ] })
        const source = refs.find((ref) => ref.role === 'source_video')
        const reference = refs.find((ref) => ref.role === 'reference_audio')
        const bgm = input.music ? refs.find((ref) => ref.role === 'bgm_audio') : undefined
        if (!source) throw new Error('VOICEOVER_SOURCE_VIDEO_REFERENCE_MISSING')
        if (!reference) throw new Error('VOICEOVER_REFERENCE_AUDIO_REFERENCE_MISSING')
        if (input.music && !bgm) throw new Error('VOICEOVER_BGM_AUDIO_REFERENCE_MISSING')
        const [videoMedia] = await resolveWorkspaceResourceInputMedia({
          userId: ctx.userId,
          projectId: ctx.projectId,
          references: [source],
          expectedMediaType: 'video',
        })
        const [referenceMedia] = await resolveWorkspaceResourceInputMedia({
          userId: ctx.userId,
          projectId: ctx.projectId,
          references: [reference],
          expectedMediaType: 'audio',
        })
        const [bgmMedia] = bgm ? await resolveWorkspaceResourceInputMedia({
          userId: ctx.userId,
          projectId: ctx.projectId,
          references: [bgm],
          expectedMediaType: 'audio',
        }) : []
        const videoDurationMs = videoMedia?.durationMs
        if (!videoDurationMs || videoDurationMs <= 0) throw new Error('VOICEOVER_VIDEO_DURATION_UNKNOWN')
        if (referenceMedia?.durationMs === null || referenceMedia?.durationMs === undefined || referenceMedia.durationMs < 3000 || referenceMedia.durationMs > 10000) throw new Error('VOICEOVER_REFERENCE_AUDIO_DURATION_INVALID')
        if (bgm && (bgmMedia?.durationMs === null || bgmMedia?.durationMs === undefined || bgmMedia.durationMs <= 0)) throw new Error('VOICEOVER_BGM_AUDIO_DURATION_INVALID')
        const sorted = [...input.voiceovers].sort((a, b) => a.startSeconds - b.startSeconds)
        if (sorted.some((item) => item.startSeconds >= videoDurationMs / 1000)) throw new Error('VOICEOVER_START_OUTSIDE_VIDEO')
        const voiceovers = await Promise.all(input.voiceovers.map(async (item) => {
          const options = {
            language: item.language,
            referenceAudio: referenceMedia.storageKey,
            referenceAudioDurationMs: referenceMedia.durationMs,
            outputFormat: 'mp3' as const,
          }
          const preflight = await preflightMediaGenerationOptions({
            userId: ctx.userId,
            modelKey: voiceModel,
            modality: 'voice',
            prompt: item.text,
            options,
          })
          const normalizedOptions = workspaceResourceVoiceoverGenerationOptionsSchema.parse(preflight.options)
          preflightMediaProviderRoutes({
            selection: preflight.selection,
            modality: 'voice',
            prompt: item.text,
            options: normalizedOptions,
          })
          return { item: { ...item, language: normalizedOptions.language }, generationOptions: normalizedOptions }
        }))
        const requestId = `produce_voiceover_video:${ctx.userId}:${ctx.projectId}:${ctx.requestId ?? stableArgsFingerprint(input)}`
        const finalResourceId = buildWorkspaceResourceId({ operationId: 'produce_voiceover_video', requestId, memberIndex: input.voiceovers.length })
        const finalPath = await resolveGeneratedWorkspaceResourcePlacement(prisma, { userId: ctx.userId, projectId: ctx.projectId, folderPath: input.folderPath, name: input.name, resourceId: finalResourceId, mediaType: 'video', schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO })
        const narration = await Promise.all(voiceovers.map(async ({ item, generationOptions }, index) => {
          const resourceId = buildWorkspaceResourceId({ operationId: 'produce_voiceover_video', requestId, memberIndex: index })
          const path = await resolveGeneratedWorkspaceResourcePlacement(prisma, { userId: ctx.userId, projectId: ctx.projectId, folderPath: input.folderPath, name: item.name, resourceId, mediaType: 'audio', schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO, alternativeIndex: index })
          const inputHash = buildWorkspaceResourceVoiceoverInputIdentity({
            prompt: item.text,
            modelKey: voiceModel,
            inputs: [{ ...reference, role: 'reference_audio', position: 0 }],
            generationOptions,
          })
          return { item, generationOptions, resourceId, path, inputHash, taskPlanId: `voiceover:${resourceId}` }
        }))
        const narrationTasks: PlannedTask[] = narration.map((entry) => createPlannedTask({ id: entry.taskPlanId, taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER, targetType: 'WorkspaceResource', targetId: entry.resourceId, payload: {
          lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{ resourceId: entry.resourceId, mediaType: 'audio', schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO, name: workspaceResourceDisplayName({ workspacePath: entry.path, resourceId: entry.resourceId }) }]), protocol: 'workspace_resource_voiceover_v1', resource: { resourceId: entry.resourceId, workspacePath: entry.path, mediaType: 'audio', schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO, inputHash: entry.inputHash, prompt: entry.item.text, modelKey: voiceModel, inputs: [{ ...reference, role: 'reference_audio', position: 0 }], toolCallId: ctx.toolCallId?.trim() || null, sourceTurnId: ctx.context.turnId?.trim() || null }, voiceModel, referenceAudio: reference, text: entry.item.text, language: entry.item.language, outputFormat: 'mp3', generationOptions: entry.generationOptions,
        }, locale: resolveOperationLocale(ctx.context), dedupeKey: `produce_voiceover_video:${entry.resourceId}:${entry.inputHash}` }))
        const mixTaskId = `voiceover-mix:${finalResourceId}`
        const mixInputs: WorkspaceResourceVoiceoverMixTaskPayload['resource']['inputs'] = [
          { ...source, role: 'source_video', position: 0 },
          { ...reference, role: 'reference_audio', position: 0 },
          ...narration.map((entry, index) => ({
            resourceId: entry.resourceId,
            contentVersion: 1,
            workspacePath: entry.path,
            role: 'voiceover_audio' as const,
            position: index,
            startSeconds: entry.item.startSeconds,
            inputHash: entry.inputHash,
          })),
          ...(bgm ? [{ ...bgm, role: 'bgm_audio' as const, position: 0 as const }] : []),
        ]
        const mixGenerationOptions = { ducking: true, preserveSourceAudio: true } as const
        const mixInputHash = buildWorkspaceResourceVoiceoverMixInputIdentity({
          inputs: mixInputs,
          generationOptions: mixGenerationOptions,
        })
        const mixPayload = { lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{ resourceId: finalResourceId, mediaType: 'video', schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO, name: workspaceResourceDisplayName({ workspacePath: finalPath, resourceId: finalResourceId }) }]), protocol: 'workspace_resource_voiceover_mix_v1', resource: { resourceId: finalResourceId, mediaType: 'video', schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO, prompt: null, modelKey: null, inputHash: mixInputHash, inputs: mixInputs, generationOptions: mixGenerationOptions, toolCallId: ctx.toolCallId?.trim() || null } }
        return { kind: 'task_submission', operationId: 'produce_voiceover_video', projectId: ctx.projectId, userId: ctx.userId, tasks: [...narrationTasks, createPlannedTask({ id: mixTaskId, taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER_MIX, targetType: 'WorkspaceResource', targetId: finalResourceId, payload: mixPayload, locale: resolveOperationLocale(ctx.context), dedupeKey: `produce_voiceover_video:mix:${finalResourceId}:${mixInputHash}` })], taskEdges: narration.map((entry) => ({ sourceTaskPlanId: entry.taskPlanId, targetTaskPlanId: mixTaskId, requirement: 'required_success' as const })), reservedIdentityIds: [finalResourceId, ...narration.map((entry) => entry.resourceId)], metadata: { requestId, finalResourceId, finalPath, narration, input, refs, source, reference, voiceModel, mixTaskId } }
      },
      commit: async (ctx, _input, plan) => {
        const tx = ctx.executionAuthorization?.transaction
        if (!tx) throw new Error('OPERATION_EXECUTION_TRANSACTION_REQUIRED')
        const metadata = plan.metadata as { finalResourceId: string; finalPath: string; narration: Array<{ resourceId: string; path: string; item: Input['voiceovers'][number]; taskPlanId: string }>; input: Input; mixTaskId: string }
        if (metadata.input.folderPath) await createWorkspaceResourceFolderInTransaction(tx, { userId: ctx.userId, projectId: ctx.projectId, workspacePath: metadata.input.folderPath, sourceType: 'operation_output_folder', sourceId: null })
        for (const task of plan.tasks) {
          const isMix = task.taskType === TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER_MIX
          const payload = isMix
            ? parseWorkspaceResourceVoiceoverMixTaskPayload(task.payload, task.target)
            : parseWorkspaceResourceVoiceoverTaskPayload(task.payload, task.target)
          const resource = payload.resourceFacts
          await reserveWorkspaceResourceInTransaction(tx, { resourceId: resource.resourceId, userId: ctx.userId, projectId: ctx.projectId, outputPath: resource.workspacePath ?? metadata.finalPath, mediaType: resource.mediaType, schemaId: resource.schemaId, operationId: 'produce_voiceover_video', operationExecutionId: ctx.executionAuthorization!.operationExecutionId, taskId: null, inputHash: resource.inputHash, prompt: resource.prompt, modelKey: resource.modelKey, generationOptions: resource.generationOptions })
        }
        const submitted = await submitPlannedOperationTasks({ ctx, operationId: 'produce_voiceover_video' })
        for (const task of plan.tasks) {
          const result = submitted.get(task.id)
          if (result) await tx.workspaceResource.updateMany({ where: { id: task.target.targetId, operationExecutionId: ctx.executionAuthorization!.operationExecutionId }, data: { taskId: result.taskId } })
        }
        const result = submitted.get(metadata.mixTaskId)
        if (!result) throw new Error('VOICEOVER_MIX_TASK_RESULT_MISSING')
        return produceVoiceoverVideoOutputSchema.parse({ success: true, async: true, total: submitted.size, taskIds: [...submitted.values()].map((value) => value.taskId), resourceId: metadata.finalResourceId, workspacePath: metadata.finalPath, narrationResourceIds: metadata.narration.map((entry) => entry.resourceId), mixTaskId: result.taskId, results: [...submitted.entries()].map(([refId, value]) => ({ refId, taskId: value.taskId })) })
      },
    }),
  }
}
