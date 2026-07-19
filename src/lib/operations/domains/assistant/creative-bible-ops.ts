import { z } from 'zod'
import {
  adoptCreativeEditBibleBundle,
  saveCreativeEditSource,
} from '@/lib/edit-bible'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

const episodeScopeSchema = z.object({
  episodeId: z.string().trim().min(1).optional()
    .describe('Exact episode ID. Omit to use the episode currently open in the workspace.'),
})

const saveEditSourceInputSchema = episodeScopeSchema.extend({
  sourceKind: z.enum(['upload', 'paste'])
    .describe('How this non-AI source entered the project. Upload requires rawFileMediaId.'),
  text: z.string().min(1)
    .describe('Complete source text to normalize and persist as one immutable SourceDocument revision.'),
  rawFileMediaId: z.string().trim().min(1).optional()
    .describe('Exact uploaded file Media identity; required only when sourceKind is upload.'),
}).strict()

const saveEditSourceOutputSchema = z.object({
  id: z.string().trim().min(1),
  normalizedText: z.string().min(1),
  checksum: z.string().length(64),
  version: z.number().int().positive(),
  sourceKind: z.enum(['upload', 'paste']),
}).strict()

const adoptEditBibleBundleInputSchema = episodeScopeSchema.extend({
  sourceDocumentId: z.string().trim().min(1)
    .describe('Exact persisted SourceDocument identity copied into the Creative Task input.'),
  taskId: z.string().trim().min(1)
    .describe('Exact completed creative_work Task whose strict edit_bible_bundle result should be adopted.'),
}).strict()

const adoptEditBibleBundleOutputSchema = z.object({
  editBibleId: z.string().trim().min(1),
  sourceDocumentId: z.string().trim().min(1),
  generationTaskId: z.string().trim().min(1),
  version: z.number().int().positive(),
  status: z.enum(['ready_for_review', 'confirmed']),
  chapterCount: z.number().int().positive(),
  chapterIds: z.array(z.string().trim().min(1)).min(1),
}).strict()

const EFFECTS_SOURCE_WRITE = {
  writes: true,
  workspaceResourceImpact: 'edit_pipeline',
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_BIBLE_ADOPTION = {
  writes: true,
  workspaceResourceImpact: 'edit_pipeline',
  billable: false,
  destructive: false,
  overwrite: true,
  bulk: true,
  externalSideEffects: false,
  longRunning: false,
} as const

function resolveEpisodeId(inputEpisodeId: string | undefined, contextEpisodeId: unknown): string {
  const episodeId = inputEpisodeId?.trim()
    || (typeof contextEpisodeId === 'string' ? contextEpisodeId.trim() : '')
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  return episodeId
}

export function createAssistantCreativeBibleOperations(): ProjectAgentOperationRegistryDraft {
  return {
    save_edit_source: defineOperation({
      id: 'save_edit_source',
      summary: 'Persist user-provided or uploaded text as a normalized immutable episode SourceDocument without running AI. Use the returned id, version, and checksum as exact domain provenance when delegating edit_bible_bundle work.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_SOURCE_WRITE,
      confirmation: { kind: 'none', required: false },
      inputSchema: saveEditSourceInputSchema,
      outputSchema: saveEditSourceOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const source = await saveCreativeEditSource({
          projectId: context.projectId,
          userId: context.userId,
          episodeId: resolveEpisodeId(input.episodeId, context.context.episodeId),
          sourceKind: input.sourceKind,
          text: input.text,
          ...(input.rawFileMediaId ? { rawFileMediaId: input.rawFileMediaId } : {}),
          client: transaction,
        })
        return saveEditSourceOutputSchema.parse({
          id: source.id,
          normalizedText: source.normalizedText,
          checksum: source.checksum,
          version: source.version,
          sourceKind: source.sourceKind,
        })
      },
    }),
    adopt_edit_bible_bundle: defineOperation({
      id: 'adopt_edit_bible_bundle',
      summary: 'Adopt one completed edit_bible_bundle Creative Task into the episode Bible. The Task, source provenance, exact source revision and strict output are revalidated; the existing Bible service atomically writes the formal Bible and its deterministic Chapter plans without starting any downstream work.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: EFFECTS_BIBLE_ADOPTION,
      confirmation: { kind: 'none', required: false },
      inputSchema: adoptEditBibleBundleInputSchema,
      outputSchema: adoptEditBibleBundleOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const adopted = await adoptCreativeEditBibleBundle({
          projectId: context.projectId,
          userId: context.userId,
          episodeId: resolveEpisodeId(input.episodeId, context.context.episodeId),
          sourceDocumentId: input.sourceDocumentId,
          taskId: input.taskId,
          client: transaction,
        })
        if (adopted.editBible.generationTaskId !== input.taskId) {
          throw new Error(`CREATIVE_EDIT_BIBLE_GENERATION_TASK_MISMATCH:${input.taskId}`)
        }
        return adoptEditBibleBundleOutputSchema.parse({
          editBibleId: adopted.editBible.id,
          sourceDocumentId: adopted.editBible.sourceDocumentId,
          generationTaskId: adopted.editBible.generationTaskId,
          version: adopted.editBible.version,
          status: adopted.editBible.status,
          chapterCount: adopted.chapters.length,
          chapterIds: adopted.chapters.map((chapter) => chapter.id),
        })
      },
    }),
  }
}
