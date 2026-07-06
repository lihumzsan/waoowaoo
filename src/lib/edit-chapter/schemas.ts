import { z } from 'zod'
import { editScriptCoreSchema } from '@/lib/edit-script/types'
import { ledgerEventSchema, ledgerSnapshotSchema } from '@/lib/edit-ledger'
import { normalizeEditScriptStructure } from '@/lib/edit-script/normalize'

export const chapterPlanInputSchema = z.object({
  projectId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1),
  chapterIndex: z.number().int().min(0),
  bibleId: z.string().trim().min(1),
  bibleVersion: z.number().int().positive(),
  styleBibleChecksum: z.string().trim().min(1),
  sourceDocumentId: z.string().trim().min(1),
  sourceStart: z.number().int().min(0),
  sourceEnd: z.number().int().min(0),
  targetDurationSec: z.number().int().positive(),
  chapterTitle: z.string().trim().min(1).nullable(),
  chapterSummary: z.string().trim().min(1).nullable(),
  sourceText: z.string().trim().min(1),
  storyBibleJson: z.unknown(),
  styleBibleJson: z.unknown(),
  entrySnapshot: ledgerSnapshotSchema,
  events: z.array(ledgerEventSchema),
}).strict().superRefine((value, context) => {
  if (value.sourceEnd <= value.sourceStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceEnd'],
      message: 'sourceEnd must be greater than sourceStart.',
    })
  }
})

export const chapterPlanOutputSchema = editScriptCoreSchema.extend({
  persistentFactsIntroduced: z.array(z.string().trim().min(1)).max(200),
}).strict()

export type ChapterPlanInput = z.infer<typeof chapterPlanInputSchema>
export type ChapterPlanOutput = z.infer<typeof chapterPlanOutputSchema>
export type NormalizedChapterPlanOutput = ReturnType<typeof normalizeEditScriptStructure> & {
  readonly persistentFactsIntroduced: readonly string[]
}

export function normalizeChapterPlanOutput(raw: unknown): NormalizedChapterPlanOutput {
  const parsed = chapterPlanOutputSchema.parse(raw)
  const normalizedCore = normalizeEditScriptStructure({
    shots: parsed.shots,
    generationSegments: parsed.generationSegments,
  })
  return {
    ...normalizedCore,
    shots: normalizedCore.shots,
    generationSegments: normalizedCore.generationSegments,
    persistentFactsIntroduced: parsed.persistentFactsIntroduced.map((fact) => fact.trim()),
  }
}
