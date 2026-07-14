import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseAudioDesignStrict } from './contract'
import { AUDIO_DESIGN_STATUS, type AudioDesign } from './types'

export type PersistedAudioDesign = {
  readonly design: AudioDesign
  readonly timelineSignature: string
  readonly designSignature: string
  readonly analysisModel: string
  readonly musicModel: string
  readonly soundEffectModel: string
}

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function readPersistedAudioDesign(row: {
  readonly status?: string | null
  readonly designJson?: unknown
  readonly timelineSignature?: string | null
  readonly designSignature?: string | null
  readonly analysisModel?: string | null
  readonly musicModel?: string | null
  readonly soundEffectModel?: string | null
} | null | undefined): PersistedAudioDesign | null {
  if (!row || row.status !== AUDIO_DESIGN_STATUS.PLANNED || row.designJson == null) return null
  const timelineSignature = text(row.timelineSignature)
  const designSignature = text(row.designSignature)
  const analysisModel = text(row.analysisModel)
  const musicModel = text(row.musicModel)
  const soundEffectModel = text(row.soundEffectModel)
  if (!timelineSignature || !designSignature || !analysisModel || !musicModel || !soundEffectModel) {
    throw new Error('AUDIO_DESIGN_PERSISTED_CONTRACT_INCOMPLETE')
  }
  return { design: parseAudioDesignStrict(row.designJson), timelineSignature, designSignature, analysisModel, musicModel, soundEffectModel }
}

export async function claimAudioDesignPlanning(input: {
  readonly episodeId: string
  readonly taskId: string
  readonly timelineSignature: string
  readonly analysisModel: string
  readonly musicModel: string
  readonly soundEffectModel: string
}): Promise<void> {
  await prisma.projectEditAudioDesign.upsert({
    where: { episodeId: input.episodeId },
    create: { ...input, status: AUDIO_DESIGN_STATUS.PLANNING },
    update: {
      taskId: input.taskId,
      status: AUDIO_DESIGN_STATUS.PLANNING,
      timelineSignature: input.timelineSignature,
      analysisModel: input.analysisModel,
      musicModel: input.musicModel,
      soundEffectModel: input.soundEffectModel,
      designJson: Prisma.JsonNull,
      designSignature: null,
      diagnosticsJson: Prisma.JsonNull,
    },
  })
}

export async function completeAudioDesignPlanning(input: {
  readonly episodeId: string
  readonly taskId: string
  readonly design: AudioDesign
  readonly designSignature: string
}): Promise<void> {
  const result = await prisma.projectEditAudioDesign.updateMany({
    where: { episodeId: input.episodeId, taskId: input.taskId, status: AUDIO_DESIGN_STATUS.PLANNING },
    data: {
      designJson: input.design as unknown as Prisma.InputJsonValue,
      designSignature: input.designSignature,
      status: AUDIO_DESIGN_STATUS.PLANNED,
      diagnosticsJson: Prisma.JsonNull,
    },
  })
  if (result.count !== 1) throw new Error(`AUDIO_DESIGN_OWNER_FENCE_REJECTED:${input.episodeId}:${input.taskId}`)
}
