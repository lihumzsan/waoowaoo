import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { StoryboardPanel } from '@/lib/storyboard-phases'
import { assertApprovedDomainMutationContext } from '@/lib/domain/approvals/guard'
import {
  assertNonEmptyText,
  type DomainMutationContext,
  DomainValidationError,
} from '@/lib/domain/shared'
import { createProjectRepository } from '@/lib/domain/repositories/project-workflow'

export type StoryboardJsonRecord = Record<string, unknown>

export type StoryboardClipPanelsResult = {
  clipId: string
  clipIndex: number
  finalPanels: StoryboardPanel[]
}

export type PersistedStoryboardResult = {
  storyboardId: string
  clipId: string
  panels: Array<{
    id: string
    panelIndex: number
    description: string | null
    srtSegment: string | null
    characters: string | null
    props: string | null
  }>
}

function assertMutationContext(input: DomainMutationContext) {
  if (!input.runId?.trim()) {
    throw new DomainValidationError('mutation runId is required')
  }
  if (!input.operationId) {
    throw new DomainValidationError('mutation operationId is required')
  }
  if (!input.idempotencyKey?.trim()) {
    throw new DomainValidationError('mutation idempotencyKey is required')
  }
}

async function replaceStoryboards(params: {
  tx: Prisma.TransactionClient
  episodeId: string
  clipPanels: StoryboardClipPanelsResult[]
}) {
  const repository = createProjectRepository(params.tx)
  const persisted: PersistedStoryboardResult[] = []
  const panelIdByStoryboardRef = new Map<string, string>()
  const storyboardIdByRef = new Map<string, string>()

  for (const clipEntry of params.clipPanels) {
    const storyboard = await repository.upsertStoryboard({
      clipId: clipEntry.clipId,
      episodeId: params.episodeId,
      panelCount: clipEntry.finalPanels.length,
    })
    storyboardIdByRef.set(storyboard.id, storyboard.id)
    storyboardIdByRef.set(clipEntry.clipId, storyboard.id)

    await repository.deletePanelsByStoryboardId(storyboard.id)

    const panels: PersistedStoryboardResult['panels'] = []
    for (let index = 0; index < clipEntry.finalPanels.length; index += 1) {
      const panel = clipEntry.finalPanels[index]
      const created = await repository.createPanel({
        storyboardId: storyboard.id,
        panelIndex: index,
        panelNumber: panel.panel_number || index + 1,
        shotType: panel.shot_type || '中景',
        cameraMove: panel.camera_move || '固定',
        description: panel.description || null,
        videoPrompt: panel.video_prompt || null,
        location: panel.location || null,
        charactersJson: panel.characters ? JSON.stringify(panel.characters) : null,
        propsJson: panel.props ? JSON.stringify(panel.props) : null,
        srtSegment: panel.source_text || null,
        photographyRulesJson: panel.photographyPlan ? JSON.stringify(panel.photographyPlan) : null,
        actingNotesJson: panel.actingNotes ? JSON.stringify(panel.actingNotes) : null,
        duration: typeof panel.duration === 'number' ? panel.duration : null,
      })
      panelIdByStoryboardRef.set(`${storyboard.id}:${created.panelIndex}`, created.id)
      panelIdByStoryboardRef.set(`${clipEntry.clipId}:${created.panelIndex}`, created.id)
      panels.push(created)
    }

    if (!storyboard.clipId) {
      throw new DomainValidationError(`storyboard clipId missing for clip workflow: ${storyboard.id}`)
    }
    persisted.push({
      storyboardId: storyboard.id,
      clipId: storyboard.clipId,
      panels,
    })
  }

  return {
    persistedStoryboards: persisted,
    panelIdByStoryboardRef,
    storyboardIdByRef,
  }
}

export async function persistStoryboardWorkflowOutputs(input: {
  episodeId: string
  clipPanels: StoryboardClipPanelsResult[]
  mutation: DomainMutationContext
}) {
  assertMutationContext(input.mutation)
  assertNonEmptyText(input.episodeId, 'episodeId')
  await assertApprovedDomainMutationContext(input.mutation)

  return await prisma.$transaction(async (tx) => {
    const storyboardResult = await replaceStoryboards({
      tx,
      episodeId: input.episodeId,
      clipPanels: input.clipPanels,
    })

    return {
      persistedStoryboards: storyboardResult.persistedStoryboards,
    }
  }, { timeout: 30000 })
}
