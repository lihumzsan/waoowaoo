import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  EditAssetKind,
  EditAssetRequirement,
  EditAssetStatus,
  EditScriptPayload,
  EditScriptShot,
  EditScriptVideoBlock,
} from './types'

export interface PersistedEditScriptRequirementForRevision {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly shotIndexes: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

interface PersistedEditScriptForRevision {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly screenplayText: string | null
  readonly title: string
  readonly logline: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status: string
  readonly assetReviewStatus: string
  readonly shotsJson: Prisma.JsonValue
  readonly videoBlocksJson: Prisma.JsonValue | null
  readonly requirements: readonly PersistedEditScriptRequirementForRevision[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readShotNumbers(value: Prisma.JsonValue): readonly number[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null))
        .filter((item): item is number => item !== null && item > 0)
    : []
}

function readJsonArray(value: Prisma.JsonValue | null): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

export function normalizeEditScriptAssetKindForRevision(value: string): EditAssetKind | null {
  return value === 'character' || value === 'location' ? value : null
}

function normalizeAssetStatus(value: string): EditAssetStatus {
  return value === 'pending' || value === 'generating' || value === 'completed' || value === 'failed'
    ? value
    : 'failed'
}

function mapEditScriptShot(value: unknown): EditScriptShot {
  const record = isRecord(value) ? value : {}
  return {
    shotNumber: readNumber(record.shotNumber),
    durationSec: readNumber(record.durationSec),
    dramaticPurpose: readString(record.dramaticPurpose),
    visibleAction: readString(record.visibleAction),
    audienceFocus: readString(record.audienceFocus),
    viewpoint: readString(record.viewpoint),
    revealPlan: readString(record.revealPlan),
    performanceBeat: readString(record.performanceBeat),
    continuityIn: readString(record.continuityIn),
    continuityOut: readString(record.continuityOut),
    charactersAndScene: readString(record.charactersAndScene),
    sound: readString(record.sound),
  }
}

function mapEditScriptVideoBlock(value: unknown): EditScriptVideoBlock | null {
  const record = isRecord(value) ? value : null
  if (!record) return null
  const kind = record.kind === 'single' || record.kind === 'group' ? record.kind : null
  if (!kind) return null
  const gridMode = record.gridMode === '2x2' || record.gridMode === '3x3' ? record.gridMode : undefined
  return {
    kind,
    shotNumbers: readShotNumbers(Array.isArray(record.shotNumbers) ? record.shotNumbers as Prisma.JsonArray : []),
    ...(gridMode ? { gridMode } : {}),
    reason: readString(record.reason),
    prompt: readString(record.prompt),
  }
}

export function mapPersistedEditScriptForRevision(script: PersistedEditScriptForRevision): EditScriptPayload {
  const shots = readJsonArray(script.shotsJson).map(mapEditScriptShot)
  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    userPrompt: script.userPrompt,
    styleBible: null,
    screenplayText: script.screenplayText,
    title: script.title,
    logline: script.logline,
    durationSec: script.durationSec,
    shotCount: script.shotCount,
    status: script.status,
    assetReviewStatus: script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
    shots,
    videoBlocks: readJsonArray(script.videoBlocksJson).map(mapEditScriptVideoBlock).filter((item): item is EditScriptVideoBlock => item !== null),
    requirements: script.requirements.map((requirement): EditAssetRequirement => ({
      id: requirement.id,
      kind: normalizeEditScriptAssetKindForRevision(requirement.kind) ?? 'character',
      name: requirement.name,
      description: requirement.description,
      shotNumbers: readShotNumbers(requirement.shotIndexes),
      status: normalizeAssetStatus(requirement.status),
      targetId: requirement.targetId,
      taskTargetType: null,
      taskTargetId: null,
      errorMessage: requirement.errorMessage,
      previewImageUrl: null,
    })),
  }
}

export async function getPersistedEditScriptForRevision(
  projectId: string,
  episodeId: string,
  editScriptId?: string,
): Promise<PersistedEditScriptForRevision | null> {
  return await prisma.projectEditScript.findFirst({
    where: {
      projectId,
      episodeId,
      ...(editScriptId ? { id: editScriptId } : {}),
    },
    include: {
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
      },
    },
  })
}
