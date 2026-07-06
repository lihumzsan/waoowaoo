import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const DEFAULT_EDIT_CHAPTER_INDEX = 0

type PrismaClientLike = typeof prisma | Prisma.TransactionClient

export interface EditChapterIdentity {
  readonly id: string
  readonly episodeId: string
  readonly chapterIndex: number
}

export async function resolveDefaultEditChapter(
  episodeId: string,
  client: PrismaClientLike = prisma,
): Promise<EditChapterIdentity> {
  const chapter = await client.projectEditChapter.findUnique({
    where: {
      episodeId_chapterIndex: {
        episodeId,
        chapterIndex: DEFAULT_EDIT_CHAPTER_INDEX,
      },
    },
    select: {
      id: true,
      episodeId: true,
      chapterIndex: true,
    },
  })
  if (!chapter) throw new Error(`PROJECT_EDIT_DEFAULT_CHAPTER_MISSING:${episodeId}`)
  return chapter
}

export async function createDefaultEditChapter(
  episodeId: string,
  client: PrismaClientLike = prisma,
): Promise<EditChapterIdentity> {
  const chapter = await client.projectEditChapter.create({
    data: {
      episodeId,
      chapterIndex: DEFAULT_EDIT_CHAPTER_INDEX,
      title: null,
      summary: null,
      status: 'ready',
    },
    select: {
      id: true,
      episodeId: true,
      chapterIndex: true,
    },
  })
  return chapter
}
