import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveDefaultEditChapter } from '@/lib/edit-chapter'
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
  readonly requiredForShotIds: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

interface PersistedEditScriptForRevision {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly corePlanJson: Prisma.JsonValue | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status: string
  readonly assetReviewStatus: string
  readonly requirements: readonly PersistedEditScriptRequirementForRevision[]
}

function readShotIds(value: Prisma.JsonValue): readonly string[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
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
    chapterId: script.chapterId,
    styleBible: null,
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
      shotIds: readShotIds(requirement.requiredForShotIds),
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
  chapterId?: string,
  editScriptId?: string,
): Promise<PersistedEditScriptForRevision | null> {
  const resolvedChapterId = chapterId ?? (await resolveDefaultEditChapter(episodeId)).id
  return await prisma.projectEditScript.findFirst({
    where: {
      projectId,
      episodeId,
      chapterId: resolvedChapterId,
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
