import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

function parseShotNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isInteger(item) && item > 0)
}

async function findVideoGroup(input: {
  readonly episodeId: string
  readonly gridMode: string
  readonly shotNumbers: readonly number[]
}) {
  const candidates = await prisma.projectVideoGroup.findMany({
    where: {
      episodeId: input.episodeId,
      gridMode: input.gridMode,
    },
  })
  return candidates.find((candidate) => sameShotNumbers(parseShotNumbers(candidate.shotNumbers), input.shotNumbers)) ?? null
}

export async function upsertComposedVideoGroupPrompt(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly gridMode: string
  readonly shotNumbers: readonly number[]
  readonly durationSec: number
  readonly prompt: string
}) {
  const existing = await findVideoGroup({
    episodeId: input.episodeId,
    gridMode: input.gridMode,
    shotNumbers: input.shotNumbers,
  })
  if (existing && (existing.status === 'queued' || existing.status === 'processing')) {
    throw new Error(`VIDEO_PROMPT_COMPOSER_GROUP_ACTIVE:${existing.id}`)
  }
  if (existing) {
    return await prisma.projectVideoGroup.update({
      where: { id: existing.id },
      data: {
        prompt: input.prompt,
        durationSec: input.durationSec,
        status: 'pending',
        taskId: null,
        errorCode: null,
        errorMessage: null,
        videoUrl: null,
        videoMedia: { disconnect: true },
      },
    })
  }
  return await prisma.projectVideoGroup.create({
    data: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      gridMode: input.gridMode,
      shotNumbers: toInputJson([...input.shotNumbers]),
      durationSec: input.durationSec,
      prompt: input.prompt,
      status: 'pending',
    },
  })
}
