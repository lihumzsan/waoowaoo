import { z } from 'zod'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource'
import { adoptChapterContinuityPlan } from '@/lib/story-canon'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

const exactResourceSchema = z.object({
  resourceId: z.string().trim().min(1),
}).strict()

const adoptChapterContinuityPlanInputSchema = z.object({
  screenplay: exactResourceSchema
    .describe('Exact immutable project.screenplay Resource used by the planning Task.'),
  chapterContinuityPlan: exactResourceSchema
    .describe('Exact immutable project.chapter_continuity_plan Resource to adopt atomically.'),
  expectedVersion: z.number().int().min(0).nullable().optional()
    .describe('Use null for first adoption, or the current adopted plan version when replacing it.'),
}).strict()

const adoptChapterContinuityPlanOutputSchema = z.object({
  success: z.literal(true),
  episodeId: z.string().trim().min(1),
  screenplayResourceId: z.string().trim().min(1),
  chapterContinuityPlanResourceId: z.string().trim().min(1),
  version: z.number().int().positive(),
  chapters: z.array(z.object({
    chapterId: z.string().trim().min(1),
    chapterIndex: z.number().int().nonnegative(),
    title: z.string().trim().min(1),
    targetDurationSec: z.number().int().positive(),
  }).strict()).min(2),
}).strict()

function requireEpisodeId(value: unknown): string {
  const episodeId = typeof value === 'string' ? value.trim() : ''
  if (!episodeId) throw new Error('CREATIVE_ADOPTION_EPISODE_CONTEXT_REQUIRED')
  return episodeId
}

export function createAssistantStoryCanonOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_chapter_continuity_plan: defineOperation({
      id: 'adopt_chapter_continuity_plan',
      summary: 'Atomically adopt one exact chapter_continuity_plan Resource derived from one exact screenplay Resource. The same Resource/version becomes the Story Canon authority and creates or replaces every Chapter projection. Use only when the user explicitly wants Chapters or professional planning has determined that at least two Chapters are useful. This starts no downstream work.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'none',
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      prerequisites: { episodeId: 'required' },
      inputSchema: adoptChapterContinuityPlanInputSchema,
      outputSchema: adoptChapterContinuityPlanOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const episodeId = requireEpisodeId(context.context.episodeId)
        const adopted = await adoptChapterContinuityPlan({
          projectId: context.projectId,
          userId: context.userId,
          episodeId,
          screenplay: input.screenplay,
          chapterContinuityPlan: input.chapterContinuityPlan,
          expectedVersion: input.expectedVersion ?? null,
          client: transaction,
        })
        return adoptChapterContinuityPlanOutputSchema.parse({
          success: true,
          episodeId,
          screenplayResourceId: input.screenplay.resourceId,
          chapterContinuityPlanResourceId: input.chapterContinuityPlan.resourceId,
          version: adopted.storyCanon.version,
          chapters: adopted.chapters.map((chapter) => ({
            chapterId: chapter.id,
            chapterIndex: chapter.chapterIndex,
            title: chapter.title,
            targetDurationSec: chapter.targetDurationSec,
          })),
        })
      },
    }),
  }
}
