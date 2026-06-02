import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { Locale } from '@/i18n/routing'
import type {
  StoryboardConsistencyAssetSnapshot,
  StoryboardConsistencySourceSnapshot,
  StoryboardConsistencySourceVideoBlock,
  StoryboardPanelPromptDraft,
} from './types'

interface StoryboardCharacterRef {
  readonly characterId: string
  readonly name: string
  readonly appearanceId: string
  readonly appearanceIndex: number
  readonly appearance: string
}

interface PanelDraft {
  readonly panelIndex: number
  readonly panelNumber: number
  readonly shotType: string
  readonly cameraMove: string
  readonly description: string
  readonly location: string | null
  readonly characters: string | null
  readonly props: string | null
  readonly srtSegment: string
  readonly srtStart: number
  readonly srtEnd: number
  readonly duration: number
  readonly imagePrompt: string
  readonly videoPrompt: string
  readonly photographyRules: string
  readonly actingNotes: string | null
  readonly sourceShotNumber: number
  readonly sourceVideoBlockId: string
}

function buildEditStoryboardMarker(editScriptId: string): string {
  return JSON.stringify({
    source: 'edit_script',
    editScriptId,
  })
}

function editStoryboardPanelSourceToJson(source: Record<string, unknown>): string {
  return JSON.stringify({
    source: 'edit_script',
    ...source,
  })
}

function locationForShot(snapshot: StoryboardConsistencySourceSnapshot, shotNumber: number) {
  return snapshot.assets.find((asset) => asset.kind === 'location' && asset.shotNumbers.includes(shotNumber)) ?? null
}

function blockForShot(snapshot: StoryboardConsistencySourceSnapshot, shotNumber: number): StoryboardConsistencySourceVideoBlock {
  const block = snapshot.videoBlocks.find((item) => item.shotNumbers.includes(shotNumber))
  if (!block) throw new Error(`EDIT_SCRIPT_STORYBOARD_VIDEO_BLOCK_MISSING:${shotNumber}`)
  return block
}

function cinematographyForShot(snapshot: StoryboardConsistencySourceSnapshot, shotNumber: number) {
  const shot = snapshot.cinematographyShotPlan.shots.find((item) => item.shotNumber === shotNumber)
  if (!shot) throw new Error(`EDIT_SCRIPT_STORYBOARD_CINEMATOGRAPHY_SHOT_MISSING:${shotNumber}`)
  return shot
}

async function buildCharacterRefsByRequirementId(
  assets: readonly StoryboardConsistencyAssetSnapshot[],
): Promise<Map<string, StoryboardCharacterRef>> {
  const characterAssets = assets.filter((asset) => asset.kind === 'character')
  const characters = await prisma.projectCharacter.findMany({
    where: {
      id: { in: characterAssets.map((asset) => asset.targetId) },
    },
    select: {
      id: true,
      name: true,
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
        take: 1,
        select: {
          id: true,
          appearanceIndex: true,
          changeReason: true,
        },
      },
    },
  })
  const characterById = new Map(characters.map((character) => [character.id, character]))
  const output = new Map<string, StoryboardCharacterRef>()
  for (const asset of characterAssets) {
    const character = characterById.get(asset.targetId)
    const appearance = character?.appearances[0]
    if (!character || !appearance) {
      throw new Error(`EDIT_SCRIPT_STORYBOARD_CHARACTER_ASSET_INVALID:${asset.name}`)
    }
    output.set(asset.requirementId, {
      characterId: character.id,
      name: character.name,
      appearanceId: appearance.id,
      appearanceIndex: appearance.appearanceIndex,
      appearance: appearance.changeReason || 'primary',
    })
  }
  return output
}

function buildVideoBlockBindings(input: {
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly panelDrafts: readonly PanelDraft[]
}) {
  const draftByShotNumber = new Map(input.panelDrafts.map((draft) => [draft.sourceShotNumber, draft]))
  return input.snapshot.videoBlocks.map((block) => {
    const drafts = block.shotNumbers.map((shotNumber) => {
      const draft = draftByShotNumber.get(shotNumber)
      if (!draft) throw new Error(`EDIT_SCRIPT_STORYBOARD_PANEL_DRAFT_MISSING:${shotNumber}`)
      return draft
    })
    return {
      sourceVideoBlockId: block.sourceVideoBlockId,
      blockIndex: block.blockIndex,
      kind: block.kind,
      shotNumbers: block.shotNumbers,
      panelNumbers: drafts.map((draft) => draft.panelNumber),
      panelIndexes: drafts.map((draft) => draft.panelIndex),
    }
  })
}

export async function upsertEditScriptStoryboardShell(input: {
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly photographyPlan: Record<string, unknown>
}) {
  const editScriptId = input.snapshot.sourceEditScriptId
  const marker = buildEditStoryboardMarker(editScriptId)
  const markerNeedle = `"editScriptId":"${editScriptId}"`
  const existing = await prisma.projectStoryboard.findFirst({
    where: {
      episodeId: input.snapshot.episodeId,
      clip: {
        screenplay: {
          contains: markerNeedle,
        },
      },
    },
    include: { clip: true },
  })

  const commonClipData = {
    end: input.snapshot.editScript.durationSec,
    duration: input.snapshot.editScript.durationSec,
    summary: input.snapshot.editScript.title,
    location: input.snapshot.assets
      .filter((asset) => asset.kind === 'location')
      .map((asset) => asset.name)
      .join('、') || null,
    characters: JSON.stringify(input.snapshot.assets
      .filter((asset) => asset.kind === 'character')
      .map((asset) => asset.name)),
    content: input.snapshot.editScript.logline || input.snapshot.editScript.userPrompt || input.snapshot.editScript.title,
    shotCount: input.snapshot.editScript.shotCount,
    screenplay: marker,
  }

  const storyboardTextJson = JSON.stringify({
    source: 'edit_script',
    sourceType: 'editScriptStoryboard',
    editScriptId,
    title: input.snapshot.editScript.title,
    shots: input.snapshot.shots,
    videoBlocks: input.snapshot.videoBlocks,
  })

  if (existing) {
    await prisma.projectClip.update({
      where: { id: existing.clipId },
      data: commonClipData,
    })
    return await prisma.projectStoryboard.update({
      where: { id: existing.id },
      data: {
        panelCount: input.snapshot.shots.length,
        storyboardTextJson,
        photographyPlan: JSON.stringify(input.photographyPlan),
      },
      include: {
        panels: { orderBy: { panelIndex: 'asc' } },
      },
    })
  }

  return await prisma.$transaction(async (tx) => {
    const clip = await tx.projectClip.create({
      data: {
        episodeId: input.snapshot.episodeId,
        start: 0,
        ...commonClipData,
        props: null,
      },
    })
    return await tx.projectStoryboard.create({
      data: {
        episodeId: input.snapshot.episodeId,
        clipId: clip.id,
        panelCount: input.snapshot.shots.length,
        storyboardTextJson,
        photographyPlan: JSON.stringify(input.photographyPlan),
      },
      include: {
        panels: { orderBy: { panelIndex: 'asc' } },
      },
    })
  })
}

function buildPanelDrafts(input: {
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly generatedPanels: readonly StoryboardPanelPromptDraft[]
  readonly characterRefsByRequirementId: ReadonlyMap<string, StoryboardCharacterRef>
  readonly locale: Locale
}): PanelDraft[] {
  const generatedByShotNumber = new Map(input.generatedPanels.map((panel) => [panel.sourceShotNumber, panel]))
  let cursor = 0
  return input.snapshot.shots.map((shot, index) => {
    const block = blockForShot(input.snapshot, shot.shotNumber)
    const generated = generatedByShotNumber.get(shot.shotNumber)
    const characterRefs = input.snapshot.assets
      .filter((asset) => asset.kind === 'character' && asset.shotNumbers.includes(shot.shotNumber))
      .map((asset) => input.characterRefsByRequirementId.get(asset.requirementId))
      .filter((reference): reference is StoryboardCharacterRef => Boolean(reference))
    const location = locationForShot(input.snapshot, shot.shotNumber)
    const srtStart = cursor
    const srtEnd = cursor + shot.durationSec
    cursor = srtEnd
    if (!generated) throw new Error(`EDIT_SCRIPT_STORYBOARD_FINAL_PROMPT_MISSING:${shot.shotNumber}`)
    const source = {
      sourceType: 'editScriptShot',
      editScriptId: input.snapshot.sourceEditScriptId,
      sourceShotNumber: shot.shotNumber,
      sourceVideoBlockId: block.sourceVideoBlockId,
      sourceVideoBlockIndex: block.blockIndex,
      sourceVideoBlockKind: block.kind,
      consistencyMode: 'spatial_text_blocking',
      consistencyMetadata: generated?.metadata ?? null,
    }
    return {
      panelIndex: index,
      panelNumber: shot.shotNumber,
      shotType: cinematographyForShot(input.snapshot, shot.shotNumber).shotScale,
      cameraMove: cinematographyForShot(input.snapshot, shot.shotNumber).movement,
      description: shot.visibleAction,
      location: location?.name ?? null,
      characters: characterRefs.length > 0 ? JSON.stringify(characterRefs) : null,
      props: null,
      srtSegment: shot.visibleAction,
      srtStart,
      srtEnd,
      duration: shot.durationSec,
      imagePrompt: generated.prompt,
      videoPrompt: generated.videoPrompt,
      photographyRules: editStoryboardPanelSourceToJson(source),
      actingNotes: null,
      sourceShotNumber: shot.shotNumber,
      sourceVideoBlockId: block.sourceVideoBlockId,
    }
  })
}

export async function upsertStoryboardPanelsFromPrompts(input: {
  readonly storyboardId: string
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly generatedPanels: readonly StoryboardPanelPromptDraft[]
  readonly locale: Locale
}): Promise<readonly { readonly id: string; readonly panelIndex: number }[]> {
  const characterRefsByRequirementId = await buildCharacterRefsByRequirementId(input.snapshot.assets)
  const panelDrafts = buildPanelDrafts({
    snapshot: input.snapshot,
    generatedPanels: input.generatedPanels,
    characterRefsByRequirementId,
    locale: input.locale,
  })
  const videoBlockBindings = buildVideoBlockBindings({
    snapshot: input.snapshot,
    panelDrafts,
  })
  const storyboardTextJson = JSON.stringify({
    source: 'edit_script',
    sourceType: 'editScriptStoryboard',
    editScriptId: input.snapshot.sourceEditScriptId,
    title: input.snapshot.editScript.title,
    shots: input.snapshot.shots,
    videoBlocks: videoBlockBindings,
  })
  const storyboard = await prisma.projectStoryboard.update({
    where: { id: input.storyboardId },
    data: {
      panelCount: panelDrafts.length,
      storyboardTextJson,
    },
    include: {
      panels: { orderBy: { panelIndex: 'asc' } },
    },
  })
  const existingPanels = new Map(storyboard.panels.map((panel) => [panel.panelIndex, panel]))
  const panelTargets: { readonly id: string; readonly panelIndex: number }[] = []
  for (const draft of panelDrafts) {
    const existingPanel = existingPanels.get(draft.panelIndex)
    const data = {
      panelNumber: draft.panelNumber,
      shotType: draft.shotType,
      cameraMove: draft.cameraMove,
      description: draft.description,
      location: draft.location,
      characters: draft.characters,
      props: draft.props,
      srtSegment: draft.srtSegment,
      srtStart: draft.srtStart,
      srtEnd: draft.srtEnd,
      duration: draft.duration,
      imagePrompt: draft.imagePrompt,
      imageUrl: null,
      imageMedia: { disconnect: true },
      candidateImages: null,
      videoPrompt: draft.videoPrompt,
      photographyRules: draft.photographyRules,
      actingNotes: draft.actingNotes,
    } satisfies Prisma.ProjectPanelUpdateInput
    if (existingPanel) {
      const panel = await prisma.projectPanel.update({
        where: { id: existingPanel.id },
        data,
      })
      panelTargets.push({ id: panel.id, panelIndex: panel.panelIndex })
      continue
    }
    const panel = await prisma.projectPanel.create({
      data: {
        storyboardId: input.storyboardId,
        panelIndex: draft.panelIndex,
        panelNumber: draft.panelNumber,
        shotType: draft.shotType,
        cameraMove: draft.cameraMove,
        description: draft.description,
        location: draft.location,
        characters: draft.characters,
        props: draft.props,
        srtSegment: draft.srtSegment,
        srtStart: draft.srtStart,
        srtEnd: draft.srtEnd,
        duration: draft.duration,
        imagePrompt: draft.imagePrompt,
        imageUrl: null,
        candidateImages: null,
        videoPrompt: draft.videoPrompt,
        photographyRules: draft.photographyRules,
        actingNotes: draft.actingNotes,
      },
    })
    panelTargets.push({ id: panel.id, panelIndex: panel.panelIndex })
  }
  return panelTargets
}
