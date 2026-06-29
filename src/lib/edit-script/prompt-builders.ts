import type {
  EditGenerationSegment,
  EditGenerationSegmentExecution,
  EditScriptKeyObject,
  EditScriptShot,
  EditScriptStyleBible,
  EditShotExecution,
} from './types'
import type { StoryboardConsistencyAssetSnapshot } from './storyboard-consistency/types'

export interface StoryboardPromptCharacterFact {
  readonly name: string
  readonly visibility: string
  readonly role: string
  readonly performance: string
  readonly position: string | null
  readonly screenPosition: string | null
  readonly facing: string | null
  readonly eyeline: string | null
  readonly referenceImageUrl: string | null
}

export interface StoryboardStillPromptFacts {
  readonly SCENE_GRAPH: Record<string, unknown>
  readonly CHARACTER_GRAPH: readonly StoryboardPromptCharacterFact[]
  readonly PROP_GRAPH: readonly Record<string, unknown>[]
  readonly REFERENCE_IMAGES: readonly Record<string, unknown>[]
  readonly STILL_FRAME: Record<string, unknown>
  readonly STYLE: Record<string, unknown>
  readonly NEGATIVE: readonly string[]
}

export interface StoryboardPromptBuildResult {
  readonly facts: StoryboardStillPromptFacts
  readonly prompt: string
}

export interface StoryboardVideoSegmentPromptFacts extends StoryboardGridPromptFacts {
  readonly GENERATION_SEGMENT: Record<string, unknown>
  readonly GENERATION_SEGMENT_EXECUTION: Record<string, unknown>
}

export interface StoryboardGridPromptFacts {
  readonly SCENE_GRAPH: unknown
  readonly BLOCKING_STATE: readonly unknown[]
  readonly CHARACTER_GRAPH: readonly StoryboardPromptCharacterFact[]
  readonly PROP_GRAPH: readonly Record<string, unknown>[]
  readonly STYLE: Record<string, unknown>
  readonly CELLS: readonly Record<string, unknown>[]
  readonly NEGATIVE: readonly string[]
}

export interface StoryboardGridPromptBuildResult {
  readonly facts: StoryboardGridPromptFacts
  readonly prompt: string
}

export interface StoryboardVideoSegmentPromptBuildResult {
  readonly facts: StoryboardVideoSegmentPromptFacts
  readonly prompt: string
}

function assetKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function findAsset(
  assets: readonly StoryboardConsistencyAssetSnapshot[],
  kind: StoryboardConsistencyAssetSnapshot['kind'],
  name: string,
): StoryboardConsistencyAssetSnapshot | null {
  const key = assetKey(name)
  return assets.find((asset) => asset.kind === kind && assetKey(asset.name) === key) ?? null
}

function blockingCharacter(execution: EditShotExecution, name: string) {
  const key = assetKey(name)
  return execution.blocking.characters.find((character) => assetKey(character.name) === key) ?? null
}

function blockingObject(execution: EditShotExecution, object: EditScriptKeyObject) {
  const key = assetKey(object.name)
  return execution.blocking.objects.find((candidate) => assetKey(candidate.name) === key) ?? null
}

function styleFacts(styleBible: EditScriptStyleBible): Record<string, unknown> {
  return {
    summary: styleBible.styleSummary,
    visual: styleBible.stylePolicy.visual,
    camera: styleBible.stylePolicy.camera,
    directing: styleBible.stylePolicy.directing,
  }
}

function negativeFacts(): readonly string[] {
  return [
    'Do not omit characters that are present but hidden, occluded, supporting, or listening.',
    'Do not create extra duplicate characters or props.',
    'Do not add subtitles, captions, logos, watermarks, UI, or visible text.',
    'Do not contradict the scene graph, character graph, prop graph, blocking state, axis, or lighting facts.',
  ]
}

function renderSection(title: string, value: unknown): string {
  return `${title}\n${JSON.stringify(value, null, 2)}`
}

function renderPrompt(sections: readonly [string, unknown][]): string {
  return sections.map(([title, value]) => renderSection(title, value)).join('\n\n')
}

export function buildStoryboardStillPromptFacts(input: {
  readonly shot: EditScriptShot
  readonly execution: EditShotExecution
  readonly segment: EditGenerationSegment
  readonly sourceGenerationSegmentId: string
  readonly assets: readonly StoryboardConsistencyAssetSnapshot[]
  readonly styleBible: EditScriptStyleBible
}): StoryboardPromptBuildResult {
  const locationAsset = findAsset(input.assets, 'location', input.shot.scene.name)
  const characters = input.shot.characters.map((character): StoryboardPromptCharacterFact => {
    const placement = blockingCharacter(input.execution, character.name)
    const asset = findAsset(input.assets, 'character', character.name)
    const referenceImageUrl = character.visibility === 'offscreen' ? null : asset?.previewImageUrl ?? null
    return {
      name: character.name,
      visibility: character.visibility,
      role: character.role,
      performance: character.performance,
      position: placement?.position ?? null,
      screenPosition: placement?.screenPosition ?? null,
      facing: placement?.facing ?? null,
      eyeline: placement?.eyeline ?? null,
      referenceImageUrl,
    }
  })
  const props = input.shot.keyObjects.map((object) => {
    const placement = blockingObject(input.execution, object)
    return {
      name: object.name,
      role: object.role,
      position: placement?.position ?? null,
      screenPosition: placement?.screenPosition ?? null,
    }
  })
  const facts: StoryboardStillPromptFacts = {
    SCENE_GRAPH: {
      sceneName: input.shot.scene.name,
      locationReference: locationAsset
        ? {
            name: locationAsset.name,
            description: locationAsset.description,
            referenceImageUrl: locationAsset.previewImageUrl,
            spatialProfile: locationAsset.spatialProfile ?? null,
          }
        : null,
      axis: input.execution.blocking.axis,
      spatialNote: input.execution.blocking.spatialNote,
    },
    CHARACTER_GRAPH: characters,
    PROP_GRAPH: props,
    REFERENCE_IMAGES: [
      ...(locationAsset?.previewImageUrl
        ? [{ kind: 'location', name: locationAsset.name, url: locationAsset.previewImageUrl }]
        : []),
      ...characters.flatMap((character) => (
        character.referenceImageUrl
          ? [{ kind: 'character', name: character.name, visibility: character.visibility, url: character.referenceImageUrl }]
          : []
      )),
    ],
    STILL_FRAME: {
      shotNumber: input.shot.shotNumber,
      durationSec: input.shot.durationSec,
      action: input.shot.action,
      sound: input.shot.sound,
      camera: input.execution.camera,
      blocking: input.execution.blocking,
      generationSegment: {
        sourceGenerationSegmentId: input.sourceGenerationSegmentId,
        shotNumbers: input.segment.shotNumbers,
        continuity: input.segment.continuity,
      },
    },
    STYLE: styleFacts(input.styleBible),
    NEGATIVE: negativeFacts(),
  }
  return {
    facts,
    prompt: renderPrompt([
      ['GLOBAL TASK', 'Generate one storyboard still image from the structured facts. The frame must show all present characters according to visibility and blocking.'],
      ['SCENE_GRAPH', facts.SCENE_GRAPH],
      ['CHARACTER_GRAPH', facts.CHARACTER_GRAPH],
      ['PROP_GRAPH', facts.PROP_GRAPH],
      ['REFERENCE_IMAGES', facts.REFERENCE_IMAGES],
      ['STILL_FRAME', facts.STILL_FRAME],
      ['STYLE', facts.STYLE],
      ['NEGATIVE', facts.NEGATIVE],
    ]),
  }
}

export function buildStoryboardPanelVideoPrompt(input: {
  readonly facts: StoryboardStillPromptFacts
}): string {
  return renderPrompt([
    ['GLOBAL TASK', 'Generate one single-shot video from the structured facts. Animate only the current shot action, camera movement, lighting, sound, and blocking. Preserve every present character, including hidden, occluded, supporting, and listener characters.'],
    ['SCENE_GRAPH', input.facts.SCENE_GRAPH],
    ['CHARACTER_GRAPH', input.facts.CHARACTER_GRAPH],
    ['PROP_GRAPH', input.facts.PROP_GRAPH],
    ['REFERENCE_IMAGES', input.facts.REFERENCE_IMAGES],
    ['VIDEO_FRAME', input.facts.STILL_FRAME],
    ['STYLE', input.facts.STYLE],
    ['NEGATIVE', [
      ...input.facts.NEGATIVE,
      'Do not add background music, songs, lyrics, UI, subtitles, logos, watermarks, or non-story text.',
      'Do not turn a hidden or occluded present character into an absent character.',
      'Do not change screen direction, axis, blocking, costume, prop identity, or location identity.',
    ]],
  ])
}

export function buildStoryboardGridPromptFacts(input: {
  readonly segment: EditGenerationSegment
  readonly sourceGenerationSegmentId: string
  readonly shots: readonly EditScriptShot[]
  readonly executions: readonly EditShotExecution[]
  readonly assets: readonly StoryboardConsistencyAssetSnapshot[]
  readonly styleBible: EditScriptStyleBible
}): StoryboardGridPromptBuildResult {
  const stills = input.shots.map((shot) => {
    const execution = input.executions.find((candidate) => candidate.shotNumber === shot.shotNumber)
    if (!execution) throw new Error(`GRID_EXECUTION_SHOT_MISSING:${shot.shotNumber}`)
    return buildStoryboardStillPromptFacts({
      shot,
      execution,
      segment: input.segment,
      sourceGenerationSegmentId: input.sourceGenerationSegmentId,
      assets: input.assets,
      styleBible: input.styleBible,
    }).facts
  })
  const facts: StoryboardGridPromptFacts = {
    SCENE_GRAPH: stills[0]?.SCENE_GRAPH ?? null,
    BLOCKING_STATE: stills.map((still) => still.STILL_FRAME),
    CHARACTER_GRAPH: stills.flatMap((still) => still.CHARACTER_GRAPH),
    PROP_GRAPH: stills.flatMap((still) => still.PROP_GRAPH),
    STYLE: styleFacts(input.styleBible),
    CELLS: input.shots.map((shot, index) => ({
      cell: index + 1,
      shotNumber: shot.shotNumber,
      shotDelta: stills[index]?.STILL_FRAME ?? null,
    })),
    NEGATIVE: negativeFacts(),
  }
  return {
    facts,
    prompt: renderPrompt([
      ['GLOBAL TASK', 'Generate a storyboard grid. Preserve one shared scene graph and only vary each cell by its shot delta.'],
      ['SCENE_GRAPH', facts.SCENE_GRAPH],
      ['BLOCKING_STATE', facts.BLOCKING_STATE],
      ['CHARACTER_GRAPH', facts.CHARACTER_GRAPH],
      ['PROP_GRAPH', facts.PROP_GRAPH],
      ['STYLE', facts.STYLE],
      ['CELLS', facts.CELLS],
      ['NEGATIVE', facts.NEGATIVE],
    ]),
  }
}

export function buildStoryboardVideoSegmentPromptFacts(input: {
  readonly segment: EditGenerationSegment
  readonly segmentExecution: EditGenerationSegmentExecution
  readonly sourceGenerationSegmentId: string
  readonly shots: readonly EditScriptShot[]
  readonly executions: readonly EditShotExecution[]
  readonly assets: readonly StoryboardConsistencyAssetSnapshot[]
  readonly styleBible: EditScriptStyleBible
}): StoryboardVideoSegmentPromptBuildResult {
  const facts = buildStoryboardGridPromptFacts(input).facts
  const videoFacts: StoryboardVideoSegmentPromptFacts = {
    ...facts,
    GENERATION_SEGMENT: {
      sourceGenerationSegmentId: input.sourceGenerationSegmentId,
      shotNumbers: input.segment.shotNumbers,
      continuity: input.segment.continuity,
      sound: input.shots.map((shot) => ({ shotNumber: shot.shotNumber, sound: shot.sound })),
    },
    GENERATION_SEGMENT_EXECUTION: {
      shotNumbers: input.segmentExecution.shotNumbers,
      motionFlow: input.segmentExecution.motionFlow,
      cameraFlow: input.segmentExecution.cameraFlow,
      blockingFlow: input.segmentExecution.blockingFlow,
      visibilityContinuity: input.segmentExecution.visibilityContinuity,
      soundFlow: input.segmentExecution.soundFlow,
      continuityLocks: input.segmentExecution.continuityLocks,
    },
  }
  return {
    facts: videoFacts,
    prompt: renderPrompt([
      ['GLOBAL TASK', 'Generate one continuous video segment from these structured facts. Preserve blocking, axis, lighting, character presence, and segment continuity.'],
      ['GENERATION_SEGMENT', videoFacts.GENERATION_SEGMENT],
      ['GENERATION_SEGMENT_EXECUTION', videoFacts.GENERATION_SEGMENT_EXECUTION],
      ['SCENE_GRAPH', videoFacts.SCENE_GRAPH],
      ['BLOCKING_STATE', videoFacts.BLOCKING_STATE],
      ['CHARACTER_GRAPH', videoFacts.CHARACTER_GRAPH],
      ['PROP_GRAPH', videoFacts.PROP_GRAPH],
      ['STYLE', videoFacts.STYLE],
      ['NEGATIVE', [
        ...videoFacts.NEGATIVE,
        'Do not mechanically restart the scene, sound field, or character positions at each shot.',
        'Do not omit hidden, occluded, partial, supporting, listener, or background characters that are present in the facts.',
        'Do not add background music, songs, lyrics, UI, subtitles, logos, watermarks, or non-story text.',
      ]],
    ]),
  }
}
