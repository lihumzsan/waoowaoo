import type {
  EditScriptKeyObject,
  EditScriptShot,
  EditScriptStyleBible,
  EditShotExecution,
} from './types'

export interface StoryboardPromptCharacterFact {
  readonly name: string
  readonly visibility: string
  readonly role: string
  readonly performance: string
  readonly position: string | null
  readonly screenPosition: string | null
  readonly facing: string | null
  readonly eyeline: string | null
}

export interface StoryboardPromptCameraFact {
  readonly shotScale: string
  readonly lens: string
  readonly focus: string
  readonly height: string
  readonly angle: string
  readonly composition: string
  readonly lighting: string
}

export interface StoryboardPromptAxisFact {
  readonly subjects: readonly string[]
  readonly screenDirection: string
}

export interface StoryboardStillPromptFacts {
  readonly SCENE: Record<string, unknown>
  readonly CHARACTERS: readonly StoryboardPromptCharacterFact[]
  readonly PROPS: readonly Record<string, unknown>[]
  readonly CAMERA: StoryboardPromptCameraFact
  readonly AXIS: StoryboardPromptAxisFact
  readonly STYLE: Record<string, unknown>
}

export interface StoryboardPromptBuildResult {
  readonly facts: StoryboardStillPromptFacts
  readonly prompt: string
}

function assetKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function blockingCharacter(execution: EditShotExecution, characterId: string) {
  return execution.blocking.characters.find((character) => character.characterId === characterId) ?? null
}

function blockingObject(execution: EditShotExecution, object: EditScriptKeyObject) {
  const key = assetKey(object.name)
  return execution.blocking.objects.find((candidate) => assetKey(candidate.name) === key) ?? null
}

function styleFacts(styleBible: EditScriptStyleBible): Record<string, unknown> {
  return {
    summary: styleBible.styleSummary,
    visual: styleBible.stylePolicy.visual,
  }
}

function stillCameraFacts(execution: EditShotExecution): StoryboardPromptCameraFact {
  return {
    shotScale: execution.camera.shotScale,
    lens: execution.camera.lens,
    focus: execution.camera.focus,
    height: execution.camera.height,
    angle: execution.camera.angle,
    composition: execution.camera.composition,
    lighting: execution.camera.lighting,
  }
}

function axisFacts(execution: EditShotExecution): StoryboardPromptAxisFact {
  return {
    subjects: execution.blocking.axis.subjects,
    screenDirection: execution.blocking.axis.screenDirection,
  }
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
  readonly styleBible: EditScriptStyleBible
}): StoryboardPromptBuildResult {
  const characters = input.shot.characters.map((character): StoryboardPromptCharacterFact => {
    const placement = blockingCharacter(input.execution, character.characterId)
    return {
      name: character.name,
      visibility: character.visibility,
      role: character.role,
      performance: character.performance,
      position: placement?.position ?? null,
      screenPosition: placement?.screenPosition ?? null,
      facing: placement?.facing ?? null,
      eyeline: placement?.eyeline ?? null,
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
    SCENE: {
      name: input.shot.scene.name,
      action: input.shot.action,
    },
    CHARACTERS: characters,
    PROPS: props,
    CAMERA: stillCameraFacts(input.execution),
    AXIS: axisFacts(input.execution),
    STYLE: styleFacts(input.styleBible),
  }
  return {
    facts,
    prompt: renderPrompt([
      ['GLOBAL TASK', 'Generate one storyboard still image. Render only the listed scene, characters, props, camera, axis, and style facts. Every character listed in CHARACTERS is physically present unless visibility is "offscreen".'],
      ['SCENE', facts.SCENE],
      ['CHARACTERS', facts.CHARACTERS],
      ['PROPS', facts.PROPS],
      ['CAMERA', facts.CAMERA],
      ['AXIS', facts.AXIS],
      ['STYLE', facts.STYLE],
    ]),
  }
}
