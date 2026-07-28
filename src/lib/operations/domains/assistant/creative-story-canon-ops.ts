import { z } from 'zod'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource'
import {
  adoptStoryCanonResources,
  adoptCreativeChapterPlan,
} from '@/lib/story-canon'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

const exactResourceSchema = z.object({
  resourceId: z.string().trim().min(1),
}).strict()

const adoptStoryCanonInputSchema = z.object({
  screenplay: exactResourceSchema.describe('Exact immutable project.screenplay Resource used by the Story Canon Task.'),
  storyCanon: exactResourceSchema.describe('Exact immutable project.story_canon Resource to adopt.'),
  expectedVersion: z.number().int().min(0).nullable().optional()
    .describe('Use null for first adoption, or the current Story Canon projection version when replacing it.'),
}).strict()

const adoptStoryCanonOutputSchema = z.object({
  success: z.literal(true),
  episodeId: z.string().trim().min(1),
  storyCanonResourceId: z.string().trim().min(1),
  version: z.number().int().positive(),
}).strict()

const adoptChaptersInputSchema = z.object({
  screenplay: exactResourceSchema.describe('Exact immutable project.screenplay Resource used to create the Chapter plan.'),
  chapterPlan: exactResourceSchema.describe('Exact immutable project.chapter_plan Resource to adopt.'),
}).strict()

const adoptChaptersOutputSchema = z.object({
  success: z.literal(true),
  episodeId: z.string().trim().min(1),
  screenplayResourceId: z.string().trim().min(1),
  chapterPlanResourceId: z.string().trim().min(1),
  chapters: z.array(z.object({
    chapterId: z.string().trim().min(1),
    chapterIndex: z.number().int().nonnegative(),
    title: z.string().trim().min(1),
    targetDurationSec: z.number().int().positive(),
  }).strict()).min(1),
}).strict()

function requireEpisodeId(value: unknown): string {
  const episodeId = typeof value === 'string' ? value.trim() : ''
  if (!episodeId) throw new Error('CREATIVE_ADOPTION_EPISODE_CONTEXT_REQUIRED')
  return episodeId
}

export function createAssistantStoryCanonOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_story_canon: defineOperation({
      id: 'adopt_story_canon',
      summary: 'Adopt one exact Story Canon Resource derived from one exact screenplay Resource. This writes only the current Story Canon/source-range projection; it does not confirm the screenplay, create Chapters, generate assets, or start downstream work.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'none',
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.STORY_CANON],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      prerequisites: { episodeId: 'required' },
      choiceCommit: { enabled: true },
      inputSchema: adoptStoryCanonInputSchema,
      outputSchema: adoptStoryCanonOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const episodeId = requireEpisodeId(context.context.episodeId)
        const storyCanon = await adoptStoryCanonResources({
          projectId: context.projectId,
          userId: context.userId,
          episodeId,
          screenplay: input.screenplay,
          storyCanon: input.storyCanon,
          expectedVersion: input.expectedVersion ?? null,
          client: transaction,
        })
        return adoptStoryCanonOutputSchema.parse({
          success: true,
          episodeId,
          storyCanonResourceId: storyCanon.storyCanonResourceId,
          version: storyCanon.version,
        })
      },
    }),
    adopt_chapters: defineOperation({
      id: 'adopt_chapters',
      summary: 'Adopt one exact chapter_plan Resource derived from one exact screenplay Resource. The Creative Skill/Subagent owns Chapter-boundary judgment; this operation only validates scope, exact lineage, source ranges and the 180-second per-Chapter ceiling, then persists the Chapter projection. Story Canon or continuity analysis may be optional context, never a prerequisite; chapter planning receives no Creative Direction. This operation starts no downstream work.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'none',
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      prerequisites: { episodeId: 'required' },
      choiceCommit: { enabled: true },
      inputSchema: adoptChaptersInputSchema,
      outputSchema: adoptChaptersOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const episodeId = requireEpisodeId(context.context.episodeId)
        const chapters = await adoptCreativeChapterPlan({
          projectId: context.projectId,
          userId: context.userId,
          episodeId,
          screenplay: input.screenplay,
          chapterPlan: input.chapterPlan,
          client: transaction,
        })
        return adoptChaptersOutputSchema.parse({
          success: true,
          episodeId,
          screenplayResourceId: input.screenplay.resourceId,
          chapterPlanResourceId: input.chapterPlan.resourceId,
          chapters: chapters.map((chapter) => ({
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
