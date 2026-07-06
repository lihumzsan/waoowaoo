import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { ApiError, getRequestId } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { CHARACTER_ASSET_IMAGE_RATIO, LOCATION_IMAGE_RATIO } from '@/lib/constants'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import type { Locale } from '@/i18n/routing'
import type {
  EditScriptAssetRevisionPayload,
  EditScriptAssetRevisionTask,
} from './types'
import {
  getPersistedEditScriptForRevision,
  mapPersistedEditScriptForRevision,
  normalizeEditScriptAssetKindForRevision,
  type PersistedEditScriptRequirementForRevision,
} from './asset-revision-persistence'

interface ReviseEditScriptAssetsInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly userId: string
  readonly locale: Locale
  readonly revisionNotes: string
  readonly editScriptId?: string
  readonly requirementId?: string
}

interface RevisionAssetTarget {
  readonly targetType: 'CharacterAppearance' | 'LocationImage'
  readonly targetId: string
  readonly body: Record<string, unknown>
  readonly hasOutputAtStart: boolean
}

function hashEditScriptAssetRevision(notes: string): string {
  return createHash('sha256').update(notes).digest('hex').slice(0, 16)
}

function buildEditScriptAssetRevisionPrompt(input: {
  readonly locale: Locale
  readonly requirement: PersistedEditScriptRequirementForRevision
  readonly revisionNotes: string
}): string {
  if (input.locale === 'en') {
    return [
      `Revise the edit-first ${input.requirement.kind} asset "${input.requirement.name}" according to the user's asset review notes.`,
      `Original asset requirement: ${input.requirement.description}`,
      `User review notes: ${input.revisionNotes}`,
      'Preserve the approved visual style and project continuity while applying the requested asset changes.',
    ].join('\n')
  }
  return [
    `根据用户的资产审核意见返工剪辑资产「${input.requirement.name}」（${input.requirement.kind}）。`,
    `原始资产需求：${input.requirement.description}`,
    `用户审核意见：${input.revisionNotes}`,
    '在应用修改意见的同时，保持已确认的视觉风格和项目连续性。',
  ].join('\n')
}

async function resolveEditScriptAssetRevisionTarget(input: {
  readonly projectId: string
  readonly requirement: PersistedEditScriptRequirementForRevision
  readonly modifyPrompt: string
  readonly revisionNotes: string
  readonly locale: Locale
}): Promise<RevisionAssetTarget | null> {
  const targetId = input.requirement.targetId?.trim() ?? ''
  if (!targetId) return null

  const revisionMeta = {
    requirementId: input.requirement.id,
    requirementName: input.requirement.name,
    revisionNotes: input.revisionNotes,
  }

  if (input.requirement.kind === 'character') {
    const character = await prisma.projectCharacter.findFirst({
      where: {
        id: targetId,
        projectId: input.projectId,
      },
      select: {
        id: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: {
            id: true,
            appearanceIndex: true,
            imageUrl: true,
            imageMediaId: true,
            imageUrls: true,
          },
        },
      },
    })
    const appearance = character?.appearances[0] ?? null
    if (!character || !appearance) return null
    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'editScript.revision.character.imageUrls')
    return {
      targetType: 'CharacterAppearance',
      targetId: appearance.id,
      hasOutputAtStart: Boolean(appearance.imageMediaId || appearance.imageUrl || imageUrls[0]),
      body: {
        type: 'character',
        characterId: character.id,
        appearanceId: appearance.id,
        appearanceIndex: appearance.appearanceIndex,
        modifyPrompt: input.modifyPrompt,
        meta: {
          locale: input.locale,
          editScriptAssetRevision: revisionMeta,
        },
      },
    }
  }

  if (input.requirement.kind === 'location') {
    const location = await prisma.projectLocation.findFirst({
      where: {
        id: targetId,
        projectId: input.projectId,
      },
      select: {
        id: true,
        selectedImageId: true,
        images: {
          orderBy: { imageIndex: 'asc' },
          select: {
            id: true,
            imageIndex: true,
            imageUrl: true,
            imageMediaId: true,
            isSelected: true,
          },
        },
      },
    })
    const image = location?.images.find((item) => item.id === location.selectedImageId)
      ?? location?.images.find((item) => item.isSelected)
      ?? location?.images.find((item) => Boolean(item.imageUrl || item.imageMediaId))
      ?? location?.images[0]
      ?? null
    if (!location || !image) return null
    return {
      targetType: 'LocationImage',
      targetId: image.id,
      hasOutputAtStart: Boolean(image.imageMediaId || image.imageUrl),
      body: {
        type: 'location',
        locationId: location.id,
        locationImageId: image.id,
        imageIndex: image.imageIndex,
        modifyPrompt: input.modifyPrompt,
        meta: {
          locale: input.locale,
          editScriptAssetRevision: revisionMeta,
        },
      },
    }
  }

  return null
}

async function submitEditScriptAssetRevisionTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
  readonly locale: Locale
  readonly scriptId: string
  readonly requirement: PersistedEditScriptRequirementForRevision
  readonly target: RevisionAssetTarget
  readonly revisionHash: string
}): Promise<Omit<EditScriptAssetRevisionTask, 'requirementId' | 'kind' | 'name'>> {
  const projectModelConfig = await getProjectModelConfig(input.projectId, input.userId)
  const aspectRatio = input.requirement.kind === 'character' ? CHARACTER_ASSET_IMAGE_RATIO : LOCATION_IMAGE_RATIO
  const billingPayload = await buildImageBillingPayload({
    projectId: input.projectId,
    userId: input.userId,
    imageModel: projectModelConfig.editModel,
    basePayload: input.target.body,
    aspectRatio,
  })
  const result = await submitTask({
    userId: input.userId,
    locale: input.locale,
    requestId: getRequestId(input.request),
    projectId: input.projectId,
    episodeId: input.episodeId,
    type: TASK_TYPE.MODIFY_ASSET_IMAGE,
    targetType: input.target.targetType,
    targetId: input.target.targetId,
    payload: withTaskUiPayload(billingPayload, {
      intent: 'modify',
      hasOutputAtStart: input.target.hasOutputAtStart,
      editScriptAssetRevision: {
        editScriptId: input.scriptId,
        requirementId: input.requirement.id,
      },
    }),
    dedupeKey: `revise_edit_script_assets:${input.scriptId}:${input.requirement.id}:${input.target.targetType}:${input.target.targetId}:${input.revisionHash}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.MODIFY_ASSET_IMAGE, billingPayload),
    operationId: 'revise_edit_script_assets',
    operationSource: 'assistant-panel',
    operationConfirmed: true,
  })
  return {
    taskId: result.taskId,
    status: result.status,
    runId: result.runId,
    deduped: result.deduped,
    taskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
    targetType: input.target.targetType,
    targetId: input.target.targetId,
  }
}

export async function reviseProjectEditScriptAssets(input: ReviseEditScriptAssetsInput): Promise<EditScriptAssetRevisionPayload> {
  const revisionNotes = input.revisionNotes.trim()
  if (!revisionNotes) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_ASSET_REVISION_NOTES_REQUIRED',
      message: 'Asset revision notes are required.',
    })
  }

  const script = await getPersistedEditScriptForRevision(input.projectId, input.episodeId, input.chapterId, input.editScriptId)
  if (!script) throw new ApiError('NOT_FOUND')

  const requirements = input.requirementId
    ? script.requirements.filter((requirement) => requirement.id === input.requirementId)
    : script.requirements
  if (input.requirementId && requirements.length === 0) throw new ApiError('NOT_FOUND')

  const revisionTargets = await Promise.all(requirements.map(async (requirement) => {
    if (!normalizeEditScriptAssetKindForRevision(requirement.kind)) {
      return {
        requirement,
        target: null,
      }
    }
    const modifyPrompt = buildEditScriptAssetRevisionPrompt({
      locale: input.locale,
      requirement,
      revisionNotes,
    })
    return {
      requirement,
      target: await resolveEditScriptAssetRevisionTarget({
        projectId: input.projectId,
        requirement,
        modifyPrompt,
        revisionNotes,
        locale: input.locale,
      }),
    }
  }))
  const missingTargets = revisionTargets.filter((item) => !item.target)
  if (missingTargets.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_ASSET_REVISION_TARGET_NOT_READY',
      message: `Edit script assets are not ready for revision: ${missingTargets.map((item) => item.requirement.name).join(', ')}`,
      requirements: missingTargets.map((item) => ({
        requirementId: item.requirement.id,
        kind: item.requirement.kind,
        name: item.requirement.name,
      })),
    })
  }

  const revisionHash = hashEditScriptAssetRevision(revisionNotes)
  const submittedTasks: EditScriptAssetRevisionTask[] = []
  for (const item of revisionTargets) {
    const target = item.target
    if (!target) {
      throw new Error('EDIT_SCRIPT_ASSET_REVISION_TARGET_UNEXPECTED_NULL')
    }
    const submittedTask = await submitEditScriptAssetRevisionTask({
      request: input.request,
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
      locale: input.locale,
      scriptId: script.id,
      requirement: item.requirement,
      target,
      revisionHash,
    })
    const kind = normalizeEditScriptAssetKindForRevision(item.requirement.kind)
    if (!kind) {
      throw new Error('EDIT_SCRIPT_ASSET_REVISION_KIND_UNEXPECTED')
    }
    submittedTasks.push({
      requirementId: item.requirement.id,
      kind,
      name: item.requirement.name,
      ...submittedTask,
    })
  }

  const updated = await getPersistedEditScriptForRevision(input.projectId, input.episodeId, script.id)
  if (!updated) throw new ApiError('NOT_FOUND')
  const editScript = mapPersistedEditScriptForRevision(updated)
  return {
    success: true,
    async: submittedTasks.length > 0,
    total: submittedTasks.length,
    revisionNotes,
    taskIds: submittedTasks.map((task) => task.taskId),
    results: submittedTasks.map((task) => ({
      refId: task.requirementId,
      taskId: task.taskId,
      taskType: task.taskType,
      targetType: task.targetType,
      targetId: task.targetId,
    })),
    submittedTasks,
    editScript,
  }
}
