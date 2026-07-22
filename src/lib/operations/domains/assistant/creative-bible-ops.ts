import { z } from 'zod'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource'
import {
  adoptCreativeBibleResources,
  adoptCreativeChapterPlan,
} from '@/lib/edit-bible'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

const exactRevisionSchema = z.object({
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
}).strict()

const adoptBibleInputSchema = z.object({
  screenplay: exactRevisionSchema.describe('Exact immutable project.source_script revision used by the Bible Task.'),
  bible: exactRevisionSchema.describe('Exact immutable project.edit_bible revision to adopt.'),
  expectedVersion: z.number().int().min(0).nullable().optional()
    .describe('Use null for first adoption, or the current Bible projection version when replacing it.'),
}).strict()

const adoptBibleOutputSchema = z.object({
  success: z.literal(true),
  episodeId: z.string().trim().min(1),
  bibleRevisionId: z.string().trim().min(1),
  version: z.number().int().positive(),
}).strict()

const adoptChaptersInputSchema = z.object({
  screenplay: exactRevisionSchema.describe('Exact immutable project.source_script revision used to create the Chapter plan.'),
  chapterPlan: exactRevisionSchema.describe('Exact immutable project.chapter_plan revision to adopt.'),
}).strict()

const adoptChaptersOutputSchema = z.object({
  success: z.literal(true),
  episodeId: z.string().trim().min(1),
  screenplayRevisionId: z.string().trim().min(1),
  chapterPlanRevisionId: z.string().trim().min(1),
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

export function createAssistantCreativeBibleOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_bible: defineOperation({
      id: 'adopt_bible',
      summary: 'Adopt one exact Bible Resource revision derived from one exact screenplay Resource revision. This writes only the current Bible/source-range projection; it does not confirm the screenplay, create Chapters, generate assets, or start downstream work.',
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
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      prerequisites: { episodeId: 'required' },
      choiceCommit: { enabled: true },
      inputSchema: adoptBibleInputSchema,
      outputSchema: adoptBibleOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const episodeId = requireEpisodeId(context.context.episodeId)
        const bible = await adoptCreativeBibleResources({
          projectId: context.projectId,
          userId: context.userId,
          episodeId,
          screenplay: input.screenplay,
          bible: input.bible,
          expectedVersion: input.expectedVersion ?? null,
          client: transaction,
        })
        return adoptBibleOutputSchema.parse({
          success: true,
          episodeId,
          bibleRevisionId: bible.bibleRevisionId,
          version: bible.version,
        })
      },
    }),
    adopt_chapters: defineOperation({
      id: 'adopt_chapters',
      summary: 'Adopt one exact chapter_plan Resource revision derived from one exact screenplay Resource revision. The Creative Skill/Subagent owns Chapter-boundary judgment; this operation only validates scope, exact lineage, source ranges and the 180-second per-Chapter ceiling, then persists the Chapter projection. A Bible, continuity analysis or Style Bible may be optional context, never a prerequisite. This operation starts no downstream work.',
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
          screenplayRevisionId: input.screenplay.revisionId,
          chapterPlanRevisionId: input.chapterPlan.revisionId,
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
