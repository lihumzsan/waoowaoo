import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import { TASK_TYPE } from '@/lib/task/types'
import {
  findTextStreamAdapters,
  findStructuredStreamAdapters,
  STRUCTURED_STREAM_ADAPTERS,
} from '@/features/project-workspace/canvas/structured-stream/structured-stream-adapters'

function adapterByKey(key: (typeof STRUCTURED_STREAM_ADAPTERS)[number]['key']) {
  const adapter = STRUCTURED_STREAM_ADAPTERS.find((item) => item.key === key)
  if (!adapter) throw new Error(`adapter missing: ${key}`)
  return adapter
}

describe('structured stream adapters', () => {
  it('maps edit script stream metadata to the core shot adapter', () => {
    const adapters = findStructuredStreamAdapters({
      taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
    })

    expect(adapters.map((adapter) => adapter.key)).toContain('editScript.shots')
  })

  it('maps edit screenplay text streams separately from JSON item adapters', () => {
    const generateAdapters = findTextStreamAdapters({
      taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
    })
    const reviseAdapters = findTextStreamAdapters({
      taskType: TASK_TYPE.EDIT_SCREENPLAY_REVISE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION,
    })

    expect(generateAdapters.map((adapter) => adapter.key)).toEqual(['editScreenplay.text'])
    expect(reviseAdapters.map((adapter) => adapter.key)).toEqual(['editScreenplay.text'])
    expect(findStructuredStreamAdapters({
      taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
    })).toEqual([])
  })

  it('validates core edit script shot items', () => {
    const adapter = adapterByKey('editScript.shots')
    const item = adapter.parseItem({
      shotNumber: 1,
      durationSec: 3,
      dramaticPurpose: 'Establish the decision.',
      visibleAction: 'The lead reaches for the sealed file.',
      audienceFocus: 'The envelope.',
      viewpoint: 'Lead character viewpoint.',
      revealPlan: 'Reveal the seal before the hand.',
      performanceBeat: 'A restrained pause.',
      continuityIn: 'Starts after the door closes.',
      continuityOut: 'Ends on the torn seal.',
      charactersAndScene: 'Lead in the archive room.',
      sound: 'Paper, distant fluorescent hum.',
    })

    expect(item.kind).toBe('editScriptShot')
    expect(adapter.itemKey(item, 0)).toBe('1')
  })

  it('validates director decoupage shot items', () => {
    const adapters = findStructuredStreamAdapters({
      taskType: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_DIRECTOR_DECOUPAGE,
    })
    expect(adapters.map((adapter) => adapter.key)).toContain('directorDecoupage.shots')

    const adapter = adapterByKey('directorDecoupage.shots')
    const item = adapter.parseItem({
      shotNumber: 2,
      durationSec: 2,
      dramaticPurpose: 'Shift suspicion.',
      visibleAction: 'The witness looks away.',
      audienceFocus: 'The witness eyes.',
      viewpoint: 'Observer viewpoint.',
      revealPlan: 'Hold the glance before dialogue.',
      performanceBeat: 'Small recoil.',
      continuityIn: 'Continues from the opened file.',
      continuityOut: 'Cuts before the denial.',
      charactersAndScene: 'Witness near the table.',
      sound: 'Chair scrape.',
    })

    expect(item.kind).toBe('directorDecoupageShot')
    expect(adapter.itemKey(item, 1)).toBe('2')
  })

  it('validates cinematography shot plan items', () => {
    const adapters = findStructuredStreamAdapters({
      taskType: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_CINEMATOGRAPHY_SHOT_PLAN,
    })
    expect(adapters.map((adapter) => adapter.key)).toContain('cinematography.shots')

    const adapter = adapterByKey('cinematography.shots')
    const item = adapter.parseItem({
      shotNumber: 3,
      shotScale: 'Medium close-up',
      lens: '50mm',
      depthOfField: 'Shallow depth of field',
      cameraPosition: 'Front left of the desk',
      cameraHeight: 'Eye level',
      cameraAngle: 'Slight low angle',
      movement: 'Slow push in',
      composition: 'Subject framed against empty shelves',
      lighting: 'Soft top light with side falloff',
      axisAndEyeline: 'Keeps left-to-right eyeline',
      continuityIn: 'Matches previous desk direction',
      continuityOut: 'Leaves space for the next reveal',
    })

    expect(item.kind).toBe('cinematographyShot')
    expect(adapter.itemKey(item, 2)).toBe('3')
  })

  it('validates storyboard final prompt panel items', () => {
    const adapter = adapterByKey('storyboard.panels')
    const item = adapter.parseItem({
      panelIndex: 0,
      sourceShotNumber: 1,
      sourceVideoBlockId: 'block-1',
      shotBlocking: {
        locationName: 'Archive room',
        absolutePosition: 'Beside the metal archive desk',
        relativePosition: 'Left of the sealed file',
        screenPosition: 'Lower center of frame',
        characterPlacements: [],
        cameraPlacement: 'Front left of the desk',
        cameraMovement: 'Slow push in',
        composition: 'Lead hand and sealed file dominate foreground',
        continuityNote: 'Door remains background left',
      },
      finalPanelPrompt: 'A cinematic frame of the lead opening a sealed archive file under quiet fluorescent light.',
      finalVideoPrompt: 'Slow push-in as the lead opens a sealed archive file while the room remains tense and still.',
    })

    expect(item.kind).toBe('storyboardPanel')
    expect(adapter.itemKey(item, 0)).toBe('0')
  })

  it('validates BGM section and layer items', () => {
    const design = adapterByKey('bgm.scoreDesign.sections').parseItem({
      category: 'intro',
      title: 'Cold open pulse',
      purpose: 'Set investigative pressure.',
      startSec: 0,
      endSec: 12,
      content: 'Muted low strings hold a narrow pulse.',
    })
    const prompt = adapterByKey('bgm.promptSections').parseItem({
      title: 'Rhythm logic',
      purpose: 'Keep edits moving.',
      startSec: 0,
      endSec: 12,
      content: 'Minimal pulse, restrained dynamics.',
    })
    const layer = adapterByKey('bgm.virtualLayers').parseItem({
      name: 'Low pulse',
      purpose: 'Creates tension without melody.',
      content: 'Subtle repeated bass texture.',
    })

    expect(design.kind).toBe('bgmDesignSection')
    expect(prompt.kind).toBe('bgmPromptSection')
    expect(layer.kind).toBe('bgmVirtualLayer')
  })

  it('validates Style Bible single-object stream sections', () => {
    const adapter = adapterByKey('styleBible.sections')
    const item = adapter.parseItem({
      strategy: 'style_bible',
      rawUserStyle: null,
      styleSummary: 'Restrained investigative noir with quiet camera language.',
      stylePolicy: {
        directing: {
          pointOfViewPrompt: 'Keep viewpoint anchored to the investigator.',
          performancePrompt: 'Underplay reactions and hold pauses.',
          informationReleasePrompt: 'Reveal evidence before faces react.',
          rhythmPrompt: 'Measured, patient shot rhythm.',
        },
        visual: {
          negativePrompt: 'No comic exaggeration.',
          imageFilterPrompt: 'Soft contrast and muted practical light.',
          lightingPrompt: 'Directional interior light with controlled falloff.',
          colorPrompt: 'Cool neutrals with restrained warm accents.',
          texturePrompt: 'Fine film grain and tactile paper texture.',
          compositionPrompt: 'Layer evidence in the foreground.',
        },
        camera: {
          movementPrompt: 'Slow motivated pushes only.',
          lensAndDepthPrompt: 'Natural focal lengths with shallow emphasis.',
          videoRhythmPrompt: 'Let cuts breathe after reveals.',
        },
        sound: {
          soundFilterPrompt: 'Quiet room tone and restrained source sound.',
        },
        hardBans: ['No slapstick staging'],
      },
    })

    expect(item.kind).toBe('styleBibleSection')
    expect(adapter.mode).toBe('object')
  })
})
