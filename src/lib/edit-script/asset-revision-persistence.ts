import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  EditAssetKind,
  EditAssetRequirement,
  EditAssetStatus,
  EditScriptPayload,
} from './types'
import { normalizeEditScriptStructure } from './normalize'

export interface PersistedEditScriptRequirementForRevision {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly requiredForShotNumbers: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

interface PersistedEditScriptForRevision {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly editScreenplayId: string
  readonly corePlanJson: Prisma.JsonValue | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status: string
  readonly assetReviewStatus: string
  readonly editScreenplay?: {
    readonly userPrompt: string
    readonly screenplayText: string
  }
  readonly requirements: readonly PersistedEditScriptRequirementForRevision[]
}

function readShotNumbers(value: Prisma.JsonValue): readonly number[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null))
        .filter((item): item is number => item !== null && item > 0)
    : []
}

export function normalizeEditScriptAssetKindForRevision(value: string): EditAssetKind | null {
  return value === 'character' || value === 'location' ? value : null
}

function normalizeAssetStatus(value: string): EditAssetStatus {
  return value === 'pending' || value === 'generating' || value === 'completed' || value === 'failed'
    ? value
    : 'failed'
}

export function mapPersistedEditScriptForRevision(script: PersistedEditScriptForRevision): EditScriptPayload {
  if (!script.corePlanJson) throw new Error(`EDIT_SCRIPT_CORE_PLAN_REQUIRED:${script.id}`)
  const core = normalizeEditScriptStructure(script.corePlanJson)
  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    screenplayId: script.editScreenplayId,
    userPrompt: script.editScreenplay?.userPrompt,
    styleBible: null,
    screenplayText: script.editScreenplay?.screenplayText ?? null,
    durationSec: core.durationSec,
    shotCount: core.shotCount,
    status: script.status,
    assetReviewStatus: script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
    shots: core.shots,
    generationSegments: core.generationSegments,
    requirements: script.requirements.map((requirement): EditAssetRequirement => ({
      id: requirement.id,
      kind: normalizeEditScriptAssetKindForRevision(requirement.kind) ?? 'character',
      name: requirement.name,
      description: requirement.description,
      shotNumbers: readShotNumbers(requirement.requiredForShotNumbers),
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
      editScreenplay: true,
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
      },
    },
  })
}
