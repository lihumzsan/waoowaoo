import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  StoryboardConsistencyAssetSnapshot,
  StoryboardConsistencySourceSnapshot,
  StoryboardConsistencyGenerationSegment,
  StoryboardPanelPromptDraft,
} from './types'

interface StoryboardCharacterRef {
  readonly characterId: string
  readonly name: string
  readonly appearanceId: string
  readonly appearanceIndex: number
  readonly appearance: string
  readonly visibility: string
  readonly role: string
  readonly performance: string
  readonly position: string | null
  readonly screenPosition: string | null
  readonly facing: string | null
  readonly eyeline: string | null
  readonly referenceImageUrl: string | null
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
  readonly imagePrompt: string | null
  readonly videoPrompt: string | null
  readonly actingNotes: string | null
  readonly sourceShotId: string
  readonly sourceGenerationSegmentId: string
  readonly executionSnapshotJson: Prisma.InputJsonValue
  readonly renderFactsJson: Prisma.InputJsonValue
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function assetKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function segmentForShot(snapshot: StoryboardConsistencySourceSnapshot, shotId: string): StoryboardConsistencyGenerationSegment {
  const segment = snapshot.generationSegments.find((item) => item.shotIds.includes(shotId))
  if (!segment) throw new Error(`EDIT_SCRIPT_STORYBOARD_SEGMENT_MISSING:${shotId}`)
  return segment
}

function locationForShot(snapshot: StoryboardConsistencySourceSnapshot, locationId: string) {
  return snapshot.assets.find((asset) => asset.kind === 'location' && asset.targetId === locationId) ?? null
}

async function buildCharacterRefsById(
  assets: readonly StoryboardConsistencyAssetSnapshot[],
): Promise<Map<string, Omit<StoryboardCharacterRef, 'visibility' | 'role' | 'performance' | 'position' | 'screenPosition' | 'facing' | 'eyeline' | 'referenceImageUrl'>>> {
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
  const output = new Map<string, Omit<StoryboardCharacterRef, 'visibility' | 'role' | 'performance' | 'position' | 'screenPosition' | 'facing' | 'eyeline' | 'referenceImageUrl'>>()
  for (const asset of characterAssets) {
    const character = characterById.get(asset.targetId)
    const appearance = character?.appearances[0]
    if (!character || !appearance) {
      throw new Error(`EDIT_SCRIPT_STORYBOARD_CHARACTER_ASSET_INVALID:${asset.name}`)
    }
    output.set(character.id, {
      characterId: character.id,
      name: character.name,
      appearanceId: appearance.id,
      appearanceIndex: appearance.appearanceIndex,
      appearance: appearance.changeReason || 'primary',
    })
  }
  return output
}

function buildStoryboardTextJson(snapshot: StoryboardConsistencySourceSnapshot): string {
  return JSON.stringify({
    source: 'edit_script',
    sourceType: 'editScriptStoryboard',
    editScriptId: snapshot.editScript.id,
    shots: snapshot.shots,
    generationSegments: snapshot.generationSegments.map((segment) => ({
      sourceGenerationSegmentId: segment.sourceGenerationSegmentId,
      segmentIndex: segment.segmentIndex,
      shotIds: segment.shotIds,
      continuity: segment.continuity,
    })),
  })
}

function dialogueLinesForShot(shot: StoryboardConsistencySourceSnapshot['shots'][number]): string[] {
  const characterNameById = new Map(shot.characters.map((character) => [character.characterId, character.name]))
  return shot.dialogue.map((line) => {
    const speaker = characterNameById.get(line.characterId)
    if (!speaker) throw new Error(`EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shot.shotNumber}:${line.characterId}`)
    return `${speaker}: ${line.line}`
  })
}

export async function upsertEditScriptStoryboard(input: {
  readonly snapshot: StoryboardConsistencySourceSnapshot
}) {
  const editScriptId = input.snapshot.editScript.id
  const existing = await prisma.projectStoryboard.findUnique({
    where: { editScriptId },
    include: {
      panels: { orderBy: { panelIndex: 'asc' } },
    },
  })
  const storyboardTextJson = buildStoryboardTextJson(input.snapshot)

  if (existing) {
    return await prisma.projectStoryboard.update({
      where: { id: existing.id },
      data: {
        chapter: { connect: { id: input.snapshot.chapterId } },
        panelCount: input.snapshot.shots.length,
        storyboardTextJson,
      },
      include: {
        panels: { orderBy: { panelIndex: 'asc' } },
      },
    })
  }

  return await prisma.projectStoryboard.create({
    data: {
      episode: { connect: { id: input.snapshot.episodeId } },
      chapter: { connect: { id: input.snapshot.chapterId } },
      editScript: { connect: { id: editScriptId } },
      panelCount: input.snapshot.shots.length,
      storyboardTextJson,
    },
    include: {
      panels: { orderBy: { panelIndex: 'asc' } },
    },
  })
}

function buildPanelDrafts(input: {
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly generatedPanels: readonly StoryboardPanelPromptDraft[]
  readonly characterRefsById: ReadonlyMap<string, Omit<StoryboardCharacterRef, 'visibility' | 'role' | 'performance' | 'position' | 'screenPosition' | 'facing' | 'eyeline' | 'referenceImageUrl'>>
}): PanelDraft[] {
  const generatedByShotId = new Map(input.generatedPanels.map((panel) => [panel.sourceShotId, panel]))
  let cursor = 0
  return input.snapshot.shots.map((shot, index) => {
    const segment = segmentForShot(input.snapshot, shot.shotId)
    const generated = generatedByShotId.get(shot.shotId)
    const location = locationForShot(input.snapshot, shot.scene.locationId)
    const execution = input.snapshot.shotExecutionPlan.shots.find((candidate) => candidate.shotId === shot.shotId)
    if (!generated || !execution) throw new Error(`EDIT_SCRIPT_STORYBOARD_PANEL_FACTS_MISSING:${shot.shotId}`)
    const srtStart = cursor
    const srtEnd = cursor + shot.durationSec
    cursor = srtEnd
    const characters = shot.characters.map((character): StoryboardCharacterRef | null => {
      const refBase = input.characterRefsById.get(character.characterId)
      const placement = execution.blocking.characters.find((candidate) => candidate.characterId === character.characterId)
      const characterAsset = input.snapshot.assets.find((asset) =>
        asset.kind === 'character' && asset.targetId === character.characterId)
      if (!refBase) return null
      return {
        ...refBase,
        visibility: character.visibility,
        role: character.role,
        performance: character.performance,
        position: placement?.position ?? null,
        screenPosition: placement?.screenPosition ?? null,
        facing: placement?.facing ?? null,
        eyeline: placement?.eyeline ?? null,
        referenceImageUrl: character.visibility === 'offscreen' ? null : characterAsset?.previewImageUrl ?? null,
      }
    }).filter((item): item is StoryboardCharacterRef => Boolean(item))
    const props = shot.keyObjects.map((object) => {
      const placement = execution.blocking.objects.find((candidate) => assetKey(candidate.name) === assetKey(object.name))
      return {
        name: object.name,
        role: object.role,
        position: placement?.position ?? null,
        screenPosition: placement?.screenPosition ?? null,
      }
    })
    return {
      panelIndex: index,
      panelNumber: shot.shotNumber,
      shotType: execution.camera.shotScale,
      cameraMove: execution.camera.movement,
      description: shot.action,
      location: location?.name ?? shot.scene.name,
      characters: characters.length > 0 ? JSON.stringify(characters) : null,
      props: props.length > 0 ? JSON.stringify(props) : null,
      srtSegment: [...dialogueLinesForShot(shot), shot.sound].filter(Boolean).join('\n'),
      srtStart,
      srtEnd,
      duration: shot.durationSec,
      imagePrompt: generated.prompt,
      videoPrompt: generated.videoPrompt,
      actingNotes: null,
      sourceShotId: shot.shotId,
      sourceGenerationSegmentId: segment.sourceGenerationSegmentId,
      executionSnapshotJson: toInputJson(generated.executionSnapshot),
      renderFactsJson: toInputJson(generated.renderFacts),
    }
  })
}

export async function upsertStoryboardPanelsFromPrompts(input: {
  readonly storyboardId: string
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly generatedPanels: readonly StoryboardPanelPromptDraft[]
}): Promise<readonly { readonly id: string; readonly panelIndex: number }[]> {
  const characterRefsById = await buildCharacterRefsById(input.snapshot.assets)
  const panelDrafts = buildPanelDrafts({
    snapshot: input.snapshot,
    generatedPanels: input.generatedPanels,
    characterRefsById,
  })
  const storyboard = await prisma.projectStoryboard.update({
    where: { id: input.storyboardId },
    data: {
      panelCount: panelDrafts.length,
      storyboardTextJson: buildStoryboardTextJson(input.snapshot),
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
      actingNotes: draft.actingNotes,
      sourceShotId: draft.sourceShotId,
      sourceGenerationSegmentId: draft.sourceGenerationSegmentId,
      executionSnapshotJson: draft.executionSnapshotJson,
      renderFactsJson: draft.renderFactsJson,
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
        videoPrompt: draft.videoPrompt,
        actingNotes: draft.actingNotes,
        sourceShotId: draft.sourceShotId,
        sourceGenerationSegmentId: draft.sourceGenerationSegmentId,
        executionSnapshotJson: draft.executionSnapshotJson,
        renderFactsJson: draft.renderFactsJson,
      },
    })
    panelTargets.push({ id: panel.id, panelIndex: panel.panelIndex })
  }
  return panelTargets
}
