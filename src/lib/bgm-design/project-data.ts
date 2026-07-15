import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseBgmDesignStrict } from './contract'
import { BGM_DESIGN_STATUS, type BgmDesign } from './types'

export type PersistedBgmDesign = {
  readonly design: BgmDesign
  readonly timelineSignature: string
  readonly designSignature: string
  readonly analysisModel: string
  readonly musicModel: string
}

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function readPersistedBgmDesign(row: {
  readonly status?: string | null
  readonly designJson?: unknown
  readonly timelineSignature?: string | null
  readonly designSignature?: string | null
  readonly analysisModel?: string | null
  readonly musicModel?: string | null
} | null | undefined): PersistedBgmDesign | null {
  if (!row || row.status !== BGM_DESIGN_STATUS.PLANNED || row.designJson == null) return null
  const timelineSignature = text(row.timelineSignature)
  const designSignature = text(row.designSignature)
  const analysisModel = text(row.analysisModel)
  const musicModel = text(row.musicModel)
  if (!timelineSignature || !designSignature || !analysisModel || !musicModel) {
    throw new Error('BGM_DESIGN_PERSISTED_CONTRACT_INCOMPLETE')
  }
  return { design: parseBgmDesignStrict(row.designJson), timelineSignature, designSignature, analysisModel, musicModel }
}

export async function claimBgmDesignPlanning(input: {
  readonly episodeId: string
  readonly taskId: string
  readonly timelineSignature: string
  readonly analysisModel: string
  readonly musicModel: string
}): Promise<void> {
  await prisma.projectEditBgmDesign.upsert({
    where: { episodeId: input.episodeId },
    create: { ...input, status: BGM_DESIGN_STATUS.PLANNING },
    update: {
      taskId: input.taskId,
      status: BGM_DESIGN_STATUS.PLANNING,
      timelineSignature: input.timelineSignature,
      analysisModel: input.analysisModel,
      musicModel: input.musicModel,
      designJson: Prisma.JsonNull,
      designSignature: null,
      diagnosticsJson: Prisma.JsonNull,
    },
  })
}

export async function completeBgmDesignPlanning(input: {
  readonly episodeId: string
  readonly taskId: string
  readonly design: BgmDesign
  readonly designSignature: string
}): Promise<void> {
  const result = await prisma.projectEditBgmDesign.updateMany({
    where: { episodeId: input.episodeId, taskId: input.taskId, status: BGM_DESIGN_STATUS.PLANNING },
    data: {
      designJson: input.design as unknown as Prisma.InputJsonValue,
      designSignature: input.designSignature,
      status: BGM_DESIGN_STATUS.PLANNED,
      diagnosticsJson: Prisma.JsonNull,
    },
  })
  if (result.count !== 1) throw new Error(`BGM_DESIGN_OWNER_FENCE_REJECTED:${input.episodeId}:${input.taskId}`)
}
