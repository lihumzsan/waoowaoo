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
  readonly sourceShotNumber: number
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

function segmentForShot(snapshot: StoryboardConsistencySourceSnapshot, shotNumber: number): StoryboardConsistencyGenerationSegment {
  const segment = snapshot.generationSegments.find((item) => item.shotNumbers.includes(shotNumber))
  if (!segment) throw new Error(`EDIT_SCRIPT_STORYBOARD_SEGMENT_MISSING:${shotNumber}`)
  return segment
}

function locationForShot(snapshot: StoryboardConsistencySourceSnapshot, shotNumber: number) {
  return snapshot.assets.find((asset) => asset.kind === 'location' && asset.shotNumbers.includes(shotNumber)) ?? null
}

async function buildCharacterRefsByAssetName(
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
    output.set(assetKey(asset.name), {
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
      shotNumbers: segment.shotNumbers,
      continuity: segment.continuity,
    })),
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
  readonly characterRefsByAssetName: ReadonlyMap<string, Omit<StoryboardCharacterRef, 'visibility' | 'role' | 'performance' | 'position' | 'screenPosition' | 'facing' | 'eyeline' | 'referenceImageUrl'>>
}): PanelDraft[] {
  const generatedByShotNumber = new Map(input.generatedPanels.map((panel) => [panel.sourceShotNumber, panel]))
  let cursor = 0
  return input.snapshot.shots.map((shot, index) => {
    const segment = segmentForShot(input.snapshot, shot.shotNumber)
    const generated = generatedByShotNumber.get(shot.shotNumber)
    const location = locationForShot(input.snapshot, shot.shotNumber)
    const execution = input.snapshot.shotExecutionPlan.shots.find((candidate) => candidate.shotNumber === shot.shotNumber)
    if (!generated || !execution) throw new Error(`EDIT_SCRIPT_STORYBOARD_PANEL_FACTS_MISSING:${shot.shotNumber}`)
    const srtStart = cursor
    const srtEnd = cursor + shot.durationSec
    cursor = srtEnd
    const characters = shot.characters.map((character): StoryboardCharacterRef | null => {
      const refBase = input.characterRefsByAssetName.get(assetKey(character.name))
      const placement = execution.blocking.characters.find((candidate) => assetKey(candidate.name) === assetKey(character.name))
      const characterAsset = input.snapshot.assets.find((asset) =>
        asset.kind === 'character' && assetKey(asset.name) === assetKey(character.name))
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
      srtSegment: [shot.action, shot.sound].filter(Boolean).join('\n'),
      srtStart,
      srtEnd,
      duration: shot.durationSec,
      imagePrompt: generated.prompt,
      videoPrompt: generated.videoPrompt,
      actingNotes: null,
      sourceShotNumber: shot.shotNumber,
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
  const characterRefsByAssetName = await buildCharacterRefsByAssetName(input.snapshot.assets)
  const panelDrafts = buildPanelDrafts({
    snapshot: input.snapshot,
    generatedPanels: input.generatedPanels,
    characterRefsByAssetName,
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
      sourceShotNumber: draft.sourceShotNumber,
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
        sourceShotNumber: draft.sourceShotNumber,
        sourceGenerationSegmentId: draft.sourceGenerationSegmentId,
        executionSnapshotJson: draft.executionSnapshotJson,
        renderFactsJson: draft.renderFactsJson,
      },
    })
    panelTargets.push({ id: panel.id, panelIndex: panel.panelIndex })
  }
  return panelTargets
}
