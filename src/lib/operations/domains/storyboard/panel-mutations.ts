import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import { serializeStructuredJsonField } from '@/lib/project-workflow/panel-ai-data-sync'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { getSignedUrl, generateUniqueKey, downloadAndUploadImage, toFetchableUrl } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStructuredJsonField(value: unknown, fieldName: string): string | null {
  try {
    return serializeStructuredJsonField(value, fieldName)
  } catch (error) {
    const message = error instanceof Error ? error.message : `${fieldName} must be valid JSON`
    throw new Error(message || 'INVALID_PARAMS')
  }
}

const storyboardMutationActionSchema = z.enum([
  'update_panel_prompt',
  'select_panel_candidate',
  'cancel_panel_candidates',
])

const storyboardMutationInputSchema = z.object({
  confirmed: z.boolean().optional(),
  action: storyboardMutationActionSchema,
  storyboardId: z.string().min(1).optional(),
  panelId: z.string().min(1).optional(),
  panelIndex: z.number().int().min(0).max(2000).optional(),
  videoPrompt: z.string().nullable().optional(),
  imagePrompt: z.string().nullable().optional(),
  selectedImageUrl: z.string().optional(),
  actingNotes: z.unknown().optional(),
}).passthrough()

export const updateStoryboardPanelPromptInputSchema = z.object({
  confirmed: z.boolean().optional(),
  storyboardId: z.string().min(1).optional(),
  panelId: z.string().min(1).optional(),
  panelIndex: z.number().int().min(0).max(2000).optional(),
  videoPrompt: z.string().nullable().optional(),
  imagePrompt: z.string().nullable().optional(),
  actingNotes: z.unknown().optional(),
}).refine((value) => Boolean(value.panelId || (value.storyboardId && typeof value.panelIndex === 'number')), {
  message: 'panelId or (storyboardId + panelIndex) is required',
  path: ['panelId'],
}).refine((value) => (
  Object.prototype.hasOwnProperty.call(value, 'videoPrompt')
  || Object.prototype.hasOwnProperty.call(value, 'imagePrompt')
  || Object.prototype.hasOwnProperty.call(value, 'actingNotes')
), {
  message: 'at least one prompt field is required',
  path: ['videoPrompt'],
})

export const selectStoryboardPanelCandidateInputSchema = z.object({
  confirmed: z.boolean().optional(),
  panelId: z.string().min(1),
  selectedImageUrl: z.string().min(1),
})

export const cancelStoryboardPanelCandidatesInputSchema = z.object({
  confirmed: z.boolean().optional(),
  panelId: z.string().min(1),
})

type StoryboardMutationInput = z.infer<typeof storyboardMutationInputSchema>

function parseUnknownArray(jsonValue: string | null): unknown[] {
  if (!jsonValue) return []
  try {
    const parsed = JSON.parse(jsonValue)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function resolveStoryboardContext(ctx: ProjectAgentOperationContext, input: StoryboardMutationInput) {
  const panelId = normalizeString(input.panelId)
  if (panelId) {
    const panel = await prisma.projectPanel.findFirst({
      where: {
        id: panelId,
        storyboard: {
          episode: {
            projectId: ctx.projectId,
          },
        },
      },
      select: {
        id: true,
        storyboardId: true,
        storyboard: { select: { episodeId: true } },
      },
    })
    if (!panel) throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
    return {
      panelId: panel.id,
      storyboardId: panel.storyboardId,
      episodeId: panel.storyboard.episodeId,
    }
  }

  const storyboardId = normalizeString(input.storyboardId)
  if (!storyboardId || typeof input.panelIndex !== 'number' || !Number.isFinite(input.panelIndex)) {
    throw new Error('PROJECT_AGENT_PANEL_REQUIRED')
  }

  const panel = await prisma.projectPanel.findFirst({
    where: {
      storyboardId,
      panelIndex: input.panelIndex,
      storyboard: {
        episode: {
          projectId: ctx.projectId,
        },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      storyboard: { select: { episodeId: true } },
    },
  })
  if (!panel) throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
  return {
    panelId: panel.id,
    storyboardId: panel.storyboardId,
    episodeId: panel.storyboard.episodeId,
  }
}

async function executeCandidateMutation(
  ctx: ProjectAgentOperationContext,
  input: StoryboardMutationInput,
  operationId: string,
) {
  const panelId = normalizeString(input.panelId)
  if (!panelId) throw new Error('PROJECT_AGENT_PANEL_REQUIRED')

  const panel = await prisma.projectPanel.findFirst({
    where: {
      id: panelId,
      storyboard: {
        episode: {
          projectId: ctx.projectId,
        },
      },
    },
    select: {
      id: true,
      imageUrl: true,
      candidateImages: true,
      storyboard: { select: { episodeId: true } },
    },
  })
  if (!panel) throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')

  if (input.action === 'cancel_panel_candidates') {
    const previousCandidateImages = panel.candidateImages
    await prisma.projectPanel.update({
      where: { id: panelId },
      data: { candidateImages: null },
    })

    const mutationBatch = await createMutationBatch({
      projectId: ctx.projectId,
      userId: ctx.userId,
      source: ctx.source,
      operationId,
      episodeId: panel.storyboard.episodeId,
      summary: `cancel_panel_candidates:${panelId}`,
      entries: [
        {
          kind: 'panel_candidates_restore',
          targetType: 'ProjectPanel',
          targetId: panelId,
          payload: { previousCandidateImages },
        },
      ],
    })

    return { success: true, panelId, mutationBatchId: mutationBatch.id }
  }

  const selectedImageUrl = normalizeString(input.selectedImageUrl)
  if (!selectedImageUrl) throw new Error('PROJECT_AGENT_SELECTED_IMAGE_REQUIRED')

  const candidateImages = parseUnknownArray(panel.candidateImages)
  const selectedCosKey = await resolveStorageKeyFromMediaValue(selectedImageUrl)
  const candidateKeys = (await Promise.all(
    candidateImages.map((candidate: unknown) => resolveStorageKeyFromMediaValue(candidate)),
  )).filter((key): key is string => !!key)

  if (!selectedCosKey || !candidateKeys.includes(selectedCosKey)) {
    throw new Error('PROJECT_AGENT_PANEL_CANDIDATE_INVALID')
  }

  let finalImageKey = selectedCosKey
  const isReusableKey = !finalImageKey.startsWith('http://')
    && !finalImageKey.startsWith('https://')
    && !finalImageKey.startsWith('/')

  if (!isReusableKey) {
    const sourceUrl = toFetchableUrl(selectedImageUrl)
    const cosKey = generateUniqueKey(`panel-${panelId}-selected`, 'png')
    finalImageKey = await downloadAndUploadImage(sourceUrl, cosKey)
  }

  const previousCandidateImages = panel.candidateImages
  const previousImageUrl = panel.imageUrl

  await prisma.projectPanel.update({
    where: { id: panelId },
    data: {
      imageUrl: finalImageKey,
      candidateImages: null,
    },
  })

  const mutationBatch = await createMutationBatch({
    projectId: ctx.projectId,
    userId: ctx.userId,
    source: ctx.source,
    operationId,
    episodeId: panel.storyboard.episodeId,
    summary: `select_panel_candidate:${panelId}`,
    entries: [
      {
        kind: 'panel_candidate_select_restore',
        targetType: 'ProjectPanel',
        targetId: panelId,
        payload: {
          previousImageUrl,
          previousCandidateImages,
        },
      },
    ],
  })

  return {
    success: true,
    panelId,
    imageUrl: getSignedUrl(finalImageKey, 7 * 24 * 3600),
    cosKey: finalImageKey,
    mutationBatchId: mutationBatch.id,
  }
}

async function executePromptMutation(
  ctx: ProjectAgentOperationContext,
  input: StoryboardMutationInput,
  operationId: string,
) {
  const { panelId, episodeId } = await resolveStoryboardContext(ctx, input)

  const updateData: Record<string, unknown> = {}
  if (Object.prototype.hasOwnProperty.call(input, 'videoPrompt')) updateData.videoPrompt = input.videoPrompt
  if (Object.prototype.hasOwnProperty.call(input, 'imagePrompt')) updateData.imagePrompt = input.imagePrompt
  if (Object.prototype.hasOwnProperty.call(input, 'actingNotes')) {
    updateData.actingNotes = toStructuredJsonField(input.actingNotes, 'actingNotes')
  }
  if (Object.keys(updateData).length === 0) {
    return { success: true, panelId, noop: true }
  }

  const before = await prisma.projectPanel.findFirst({
    where: { id: panelId },
    select: {
      id: true,
      videoPrompt: true,
      imagePrompt: true,
      actingNotes: true,
    },
  })
  if (!before) throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')

  await prisma.projectPanel.update({
    where: { id: panelId },
    data: updateData,
  })

  const mutationBatch = await createMutationBatch({
    projectId: ctx.projectId,
    userId: ctx.userId,
    source: ctx.source,
    operationId,
    episodeId,
    summary: `update_panel_prompt:${panelId}`,
    entries: [
      {
        kind: 'panel_prompt_restore',
        targetType: 'ProjectPanel',
        targetId: panelId,
        payload: {
          previousVideoPrompt: before.videoPrompt,
          previousImagePrompt: before.imagePrompt,
          previousActingNotes: before.actingNotes,
        },
      },
    ],
  })

  return { success: true, panelId, mutationBatchId: mutationBatch.id }
}

export async function executeStoryboardMutationOperation(
  ctx: ProjectAgentOperationContext,
  input: StoryboardMutationInput,
  operationId: string,
) {
  if (input.action === 'select_panel_candidate' || input.action === 'cancel_panel_candidates') {
    return await executeCandidateMutation(ctx, input, operationId)
  }

  return await executePromptMutation(ctx, input, operationId)
}
