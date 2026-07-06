import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { EDIT_BIBLE_STATUS } from '@/lib/edit-bible'
import {
  collectLedgerEventsInRange,
  ledgerSchema,
  projectLedgerSnapshotAtSourceOffset,
  type Ledger,
  type LedgerEvent,
  type LedgerSnapshot,
} from '@/lib/edit-ledger'
import {
  editScriptStyleBibleSchema,
  type EditScriptStyleBible,
} from '@/lib/edit-script/types'
import { chapterPlanInputSchema, type ChapterPlanInput } from './schemas'

type PrismaClientLike = typeof prisma | Prisma.TransactionClient

export interface AssembledChapterPlanInput extends ChapterPlanInput {
  readonly ledger: Ledger
  readonly styleBible: EditScriptStyleBible
}

function parseRequiredStyleBibleJson(value: Prisma.JsonValue | null): EditScriptStyleBible {
  if (value === null) throw new Error('EDIT_BIBLE_STYLE_BIBLE_REQUIRED')
  const parsed = editScriptStyleBibleSchema.safeParse({ styleBible: value })
  if (!parsed.success) throw new Error('EDIT_BIBLE_STYLE_BIBLE_INVALID')
  return parsed.data.styleBible
}

function parseRequiredLedgerJson(value: Prisma.JsonValue | null): Ledger {
  if (value === null) throw new Error('EDIT_BIBLE_LEDGER_REQUIRED')
  return ledgerSchema.parse(value)
}

function requireStoryBibleJson(value: Prisma.JsonValue | null): Prisma.JsonValue {
  if (value === null) throw new Error('EDIT_BIBLE_JSON_REQUIRED')
  return value
}

function checksumJsonValue(value: Prisma.JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function assertSourceRangeInDocument(input: {
  readonly chapterId: string
  readonly sourceStart: number
  readonly sourceEnd: number
  readonly normalizedText: string
}): void {
  if (input.sourceEnd <= input.sourceStart) {
    throw new Error(`EDIT_CHAPTER_SOURCE_RANGE_INVALID:${input.chapterId}:${String(input.sourceStart)}:${String(input.sourceEnd)}`)
  }
  if (input.sourceEnd > input.normalizedText.length) {
    throw new Error(`EDIT_CHAPTER_SOURCE_RANGE_OUT_OF_BOUNDS:${input.chapterId}:${String(input.sourceEnd)}:${String(input.normalizedText.length)}`)
  }
}

export async function assembleChapterPlanInput(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly client?: PrismaClientLike
}): Promise<AssembledChapterPlanInput> {
  const client = input.client ?? prisma
  const chapter = await client.projectEditChapter.findFirst({
    where: {
      id: input.chapterId,
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
    },
    include: {
      sourceDocument: true,
      episode: {
        include: {
          editBible: true,
        },
      },
    },
  })
  if (!chapter) throw new Error(`EDIT_CHAPTER_NOT_FOUND:${input.chapterId}`)
  if (!chapter.sourceDocument || !chapter.sourceDocumentId || chapter.sourceStart === null || chapter.sourceEnd === null) {
    throw new Error(`EDIT_CHAPTER_SOURCE_DOCUMENT_REQUIRED:${chapter.id}`)
  }
  if (chapter.targetDurationSec === null) {
    throw new Error(`EDIT_CHAPTER_TARGET_DURATION_REQUIRED:${chapter.id}`)
  }
  const bible = chapter.episode.editBible
  if (!bible) throw new Error(`EDIT_BIBLE_REQUIRED:${input.episodeId}`)
  if (bible.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new Error(`EDIT_BIBLE_NOT_CONFIRMED:${bible.status}`)
  }
  assertSourceRangeInDocument({
    chapterId: chapter.id,
    sourceStart: chapter.sourceStart,
    sourceEnd: chapter.sourceEnd,
    normalizedText: chapter.sourceDocument.normalizedText,
  })
  const storyBibleJson = requireStoryBibleJson(bible.bibleJson)
  const ledger = parseRequiredLedgerJson(bible.ledgerJson)
  const styleBibleJson = bible.styleBibleJson
  if (styleBibleJson === null) throw new Error('EDIT_BIBLE_STYLE_BIBLE_REQUIRED')
  const styleBible = parseRequiredStyleBibleJson(styleBibleJson)
  const entrySnapshot: LedgerSnapshot = projectLedgerSnapshotAtSourceOffset({
    ledger,
    sourceEnd: chapter.sourceStart,
  })
  const events: readonly LedgerEvent[] = collectLedgerEventsInRange({
    ledger,
    sourceStart: chapter.sourceStart,
    sourceEnd: chapter.sourceEnd,
  })
  const sourceText = chapter.sourceDocument.normalizedText.slice(chapter.sourceStart, chapter.sourceEnd)
  const assembled = chapterPlanInputSchema.parse({
    projectId: input.projectId,
    episodeId: input.episodeId,
    chapterId: chapter.id,
    chapterIndex: chapter.chapterIndex,
    bibleId: bible.id,
    bibleVersion: bible.version,
    styleBibleChecksum: checksumJsonValue(styleBibleJson),
    sourceDocumentId: chapter.sourceDocumentId,
    sourceStart: chapter.sourceStart,
    sourceEnd: chapter.sourceEnd,
    targetDurationSec: chapter.targetDurationSec,
    chapterTitle: chapter.title,
    chapterSummary: chapter.summary,
    sourceText,
    storyBibleJson,
    styleBibleJson,
    entrySnapshot,
    events: [...events],
  })
  return {
    ...assembled,
    ledger,
    styleBible,
  }
}
