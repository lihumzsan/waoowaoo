import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAiPrompt } from '@/lib/ai-prompts'
import { executeAiTextStep, executeAiVisionStep } from '@/lib/ai-exec/engine'
import {
  analyzeGridCoordinates,
  generateCameraPlan,
  generateGridFloorPlan,
} from '@/lib/edit-script/storyboard-consistency/model-generation'
import {
  buildFloorPlanSceneGroups,
  classifyStoryboardConsistencyBlocks,
  resolveAspectRatioFromDimensions,
  resolveGridDensity,
  resolveGridDensityFromDimensions,
} from '@/lib/edit-script/storyboard-consistency/strategies'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'

vi.mock('@/lib/ai-prompts', () => ({
  AI_PROMPT_IDS: {
    EDIT_SCRIPT_STORYBOARD_GRID_FLOOR_PLAN: 'edit-script-storyboard-grid-floor-plan',
    EDIT_SCRIPT_STORYBOARD_GRID_VISION: 'edit-script-storyboard-grid-vision',
    EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN: 'edit-script-storyboard-camera-plan',
    EDIT_SCRIPT_STORYBOARD_CAMERA_STYLE_BIBLE: 'edit-script-storyboard-camera-style-bible',
    EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN_BLOCK: 'edit-script-storyboard-camera-plan-block',
  },
  buildAiPrompt: vi.fn((input: { readonly promptId: string }) => `prompt:${input.promptId}`),
}))

vi.mock('@/lib/ai-exec/engine', () => ({
  executeAiTextStep: vi.fn(),
  executeAiVisionStep: vi.fn(),
}))

const textStepMock = vi.mocked(executeAiTextStep)
const visionStepMock = vi.mocked(executeAiVisionStep)
const buildAiPromptMock = vi.mocked(buildAiPrompt)

function buildStyleBible(): StoryboardConsistencySourceSnapshot['styleBible'] {
  return {
    strategy: 'style_bible',
    rawUserStyle: 'temple lesson',
    styleSummary: 'Restrained naturalistic temple visual style.',
    stylePolicy: {
      rawUserStyle: 'temple lesson',
      styleSummary: 'Restrained naturalistic temple visual style.',
      visual: {
        positivePrompt: 'Soft natural light, low contrast, quiet temple textures.',
        negativePrompt: 'No subtitles, no logos, no commercial gloss.',
        imageFilterPrompt: 'soft natural light, low contrast, quiet temple textures',
        lightingPrompt: 'Soft diffused daylight.',
        colorPrompt: 'Muted stone, wood, and gray green.',
        texturePrompt: 'Stone, wood, linen, and fine film grain.',
        compositionPrompt: 'Stable balanced composition.',
      },
      camera: {
        rhythmPrompt: 'Slow rhythm.',
        movementPrompt: 'Locked camera and slow push-in.',
        lensAndDepthPrompt: '35mm lens, natural depth.',
        editingPacingPrompt: 'Restrained pacing.',
      },
      motion: {
        subjectMotionPrompt: 'Small slow gestures.',
        actingPrompt: 'Contained acting.',
      },
      sound: {
        positivePrompt: 'Natural quiet room tone.',
        negativePrompt: 'No continuous music.',
        soundFilterPrompt: 'soft natural low dynamic sound',
        soundStylePrompt: 'Quiet ambience.',
      },
      hardBans: ['No subtitles.', 'No watermark.', 'No logo.'],
    },
  }
}

function mockTextCompletion(text: string): Awaited<ReturnType<typeof executeAiTextStep>> {
  return {
    text,
    reasoning: '',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    completion: {
      id: 'completion-1',
      object: 'chat.completion',
      created: 0,
      model: 'analysis-model',
      choices: [],
    } as Awaited<ReturnType<typeof executeAiTextStep>>['completion'],
  }
}

function mockVisionCompletion(text: string): Awaited<ReturnType<typeof executeAiVisionStep>> {
  return {
    text,
    reasoning: '',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    completion: {
      id: 'completion-1',
      object: 'chat.completion',
      created: 0,
      model: 'analysis-model',
      choices: [],
    } as Awaited<ReturnType<typeof executeAiVisionStep>>['completion'],
  }
}

function buildSnapshot(overrides: Partial<StoryboardConsistencySourceSnapshot> = {}): StoryboardConsistencySourceSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceEditScriptId: 'edit-1',
    project: {
      videoRatio: '16:9',
    },
    editScript: {
      id: 'edit-1',
      title: 'Temple Lesson',
      logline: 'A monk teaches a young disciple.',
      durationSec: 10,
      shotCount: 2,
      userPrompt: 'temple lesson',
      screenplayText: null,
    },
    styleBible: buildStyleBible(),
    shots: [
      {
        shotNumber: 1,
        durationSec: 5,
        visualAction: 'Old monk speaks beside the flower bed.',
        charactersAndScene: 'Old monk and young disciple in the same temple courtyard.',
        camera: 'medium close-up',
        videoPrompt: 'Dialogue over the flower bed.',
        sound: 'quiet wind',
      },
      {
        shotNumber: 2,
        durationSec: 5,
        visualAction: 'Young disciple listens and answers.',
        charactersAndScene: 'Young disciple and old monk remain in the temple courtyard.',
        camera: 'reverse medium close-up',
        videoPrompt: 'Reverse dialogue over the flower bed.',
        sound: 'soft reply',
      },
    ],
    videoBlocks: [
      {
        kind: 'group',
        shotNumbers: [1, 2],
        reason: 'two-person dialogue in one fixed courtyard',
        prompt: 'A two-person dialogue around one flower bed.',
        blockIndex: 0,
        sourceVideoBlockId: 'edit-1:videoBlock:1',
      },
    ],
    assets: [
      {
        requirementId: 'char-1',
        kind: 'character',
        name: 'Old monk',
        description: 'elderly monk',
        shotNumbers: [1, 2],
        targetId: 'character-1',
        previewImageUrl: 'https://cdn.example.com/old-monk.png',
      },
      {
        requirementId: 'char-2',
        kind: 'character',
        name: 'Young disciple',
        description: 'young disciple',
        shotNumbers: [1, 2],
        targetId: 'character-2',
        previewImageUrl: 'https://cdn.example.com/disciple.png',
      },
      {
        requirementId: 'loc-1',
        kind: 'location',
        name: 'Temple courtyard',
        description: 'courtyard with a central flower bed',
        shotNumbers: [1, 2],
        targetId: 'location-1',
        previewImageUrl: 'https://cdn.example.com/courtyard.png',
      },
    ],
    ...overrides,
  }
}

describe('edit-script storyboard coordinate consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('derives grid density from the project video ratio', () => {
    expect(resolveGridDensity('16:9')).toEqual({ columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 })
    expect(resolveGridDensity('9:16')).toEqual({ columns: 9, rows: 16, ratio: '9:16', shortSideUnits: 9 })
    expect(resolveGridDensity('21:9')).toEqual({ columns: 21, rows: 9, ratio: '21:9', shortSideUnits: 9 })
    expect(resolveGridDensity('1:1')).toEqual({ columns: 9, rows: 9, ratio: '1:1', shortSideUnits: 9 })
  })

  it('derives floor-plan grid density from actual image dimensions without forcing project ratio', () => {
    expect(resolveAspectRatioFromDimensions(1024, 1024)).toBe('1:1')
    expect(resolveGridDensityFromDimensions(1024, 1024)).toEqual({ columns: 9, rows: 9, ratio: '1:1', shortSideUnits: 9 })
    expect(resolveAspectRatioFromDimensions(1536, 864)).toBe('16:9')
    expect(resolveGridDensityFromDimensions(1536, 864)).toEqual({ columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 })
  })

  it('classifies repeated two-person locations as fixed-space and skips chase or montage language', () => {
    const [dialogue] = classifyStoryboardConsistencyBlocks(buildSnapshot())
    expect(dialogue).toMatchObject({
      classification: 'fixed_space_strong',
      participantNames: ['Old monk', 'Young disciple'],
      locationNames: ['Temple courtyard'],
    })

    const [singleCharacterFixedLocation] = classifyStoryboardConsistencyBlocks(buildSnapshot({
      assets: buildSnapshot().assets.filter((asset) => asset.name !== 'Young disciple'),
      shots: buildSnapshot().shots.map((shot) => ({
        ...shot,
        charactersAndScene: 'Old monk remains in the same temple courtyard.',
        visualAction: 'Old monk crosses the same temple courtyard.',
      })),
      videoBlocks: [{
        ...buildSnapshot().videoBlocks[0],
        prompt: 'A monk repeatedly moves through the same temple courtyard.',
      }],
    }))
    expect(singleCharacterFixedLocation).toMatchObject({
      classification: 'fixed_space_weak',
      participantNames: ['Old monk'],
      locationNames: ['Temple courtyard'],
    })

    const [chase] = classifyStoryboardConsistencyBlocks(buildSnapshot({
      videoBlocks: [{
        ...buildSnapshot().videoBlocks[0],
        prompt: 'A fast chase montage through the courtyard.',
      }],
    }))
    expect(chase?.classification).toBe('no_fixed_space')
    expect(chase?.excludedByMotionOrAbstraction).toBe(true)
  })

  it('uses the LLM to prepare floor-plan prompts and does not invent coordinates in prepare', async () => {
    textStepMock.mockResolvedValueOnce(mockTextCompletion(JSON.stringify({
        strategyOutput: {
          strategy: 'grid_coordinates',
          grid: { columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 },
          floorPlans: [{
            sourceVideoBlockIds: ['edit-1:videoBlock:1'],
            groupIndex: 0,
            classification: 'fixed_space_strong',
            location: 'Temple courtyard',
            participants: ['Old monk', 'Young disciple'],
            anchors: ['flower bed'],
            skipped: false,
            reason: 'Fixed two-person dialogue around one anchor.',
            prompt: 'Top-down 2D floor plan of a temple courtyard with a central flower bed.',
          }],
        },
      })))

    const output = await generateGridFloorPlan({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot: buildSnapshot(),
    })

    expect(textStepMock).toHaveBeenCalledTimes(1)
    expect(output.floorPlans[0]).toMatchObject({
      sourceVideoBlockIds: ['edit-1:videoBlock:1'],
      prompt: 'Top-down 2D floor plan of a temple courtyard with a central flower bed.',
    })
    expect('coordinates' in output.floorPlans[0]).toBe(false)
  })

  it('groups one floor plan per unique scene asset across multiple videoBlocks', async () => {
    const snapshot = buildSnapshot({
      videoBlocks: [
        buildSnapshot().videoBlocks[0],
        {
          ...buildSnapshot().videoBlocks[0],
          sourceVideoBlockId: 'edit-1:videoBlock:2',
          blockIndex: 1,
          shotNumbers: [1, 2],
          prompt: 'The same temple courtyard later in the story.',
        },
      ],
    })
    const groups = buildFloorPlanSceneGroups(snapshot)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      locationTargetId: 'location-1',
      sourceVideoBlockIds: ['edit-1:videoBlock:1', 'edit-1:videoBlock:2'],
      locationName: 'Temple courtyard',
    })

    textStepMock.mockResolvedValueOnce(mockTextCompletion(JSON.stringify({
      strategyOutput: {
        strategy: 'grid_coordinates',
        grid: { columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 },
        floorPlans: [
          {
            sourceVideoBlockIds: ['edit-1:videoBlock:1'],
            groupIndex: 0,
            classification: 'fixed_space_strong',
            location: 'Temple courtyard',
            participants: ['Old monk', 'Young disciple'],
            anchors: ['flower bed'],
            skipped: false,
            reason: 'First block in same courtyard.',
            prompt: 'Top-down 2D floor plan of the temple courtyard.',
          },
          {
            sourceVideoBlockIds: ['edit-1:videoBlock:2'],
            groupIndex: 1,
            classification: 'fixed_space_strong',
            location: 'Temple courtyard',
            participants: ['Old monk', 'Young disciple'],
            anchors: ['flower bed'],
            skipped: false,
            reason: 'Second block in same courtyard.',
            prompt: 'Duplicate top-down 2D floor plan of the temple courtyard.',
          },
        ],
      },
    })))

    const output = await generateGridFloorPlan({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot,
    })

    expect(output.floorPlans).toHaveLength(1)
    expect(output.floorPlans[0]).toMatchObject({
      sourceVideoBlockIds: ['edit-1:videoBlock:1', 'edit-1:videoBlock:2'],
      location: 'Temple courtyard',
    })
  })

  it('matches floor plans by location when multiple scene groups share videoBlocks', async () => {
    const snapshot = buildSnapshot({
      assets: [
        ...buildSnapshot().assets,
        {
          requirementId: 'loc-2',
          kind: 'location',
          name: 'Training hall',
          description: 'interior hall with a wooden doorway and stone wall',
          shotNumbers: [1, 2],
          targetId: 'location-2',
          previewImageUrl: 'https://cdn.example.com/training-hall.png',
        },
      ],
    })
    const groups = buildFloorPlanSceneGroups(snapshot)
    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.sourceVideoBlockIds)).toEqual([
      ['edit-1:videoBlock:1'],
      ['edit-1:videoBlock:1'],
    ])

    textStepMock.mockResolvedValueOnce(mockTextCompletion(JSON.stringify({
      strategyOutput: {
        strategy: 'grid_coordinates',
        grid: { columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 },
        floorPlans: [
          {
            sourceVideoBlockIds: ['edit-1:videoBlock:1'],
            groupIndex: 0,
            classification: 'fixed_space_strong',
            location: 'Temple courtyard',
            participants: ['Old monk', 'Young disciple'],
            anchors: ['flower bed'],
            skipped: false,
            reason: 'Courtyard blocking needs a stable plan.',
            prompt: 'Top-down 2D floor plan of the temple courtyard.',
          },
          {
            sourceVideoBlockIds: ['edit-1:videoBlock:1'],
            groupIndex: 1,
            classification: 'fixed_space_strong',
            location: 'Training hall',
            participants: ['Old monk', 'Young disciple'],
            anchors: ['wooden doorway', 'stone wall'],
            skipped: false,
            reason: 'Training hall blocking needs a separate stable plan.',
            prompt: 'Top-down 2D floor plan of the training hall.',
          },
        ],
      },
    })))

    const output = await generateGridFloorPlan({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot,
    })

    expect(output.floorPlans).toHaveLength(2)
    expect(output.floorPlans.map((plan) => plan.location)).toEqual(['Temple courtyard', 'Training hall'])
  })

  it('accepts empty floor plans when the model decides scene groups are unsuitable for coordinates', async () => {
    expect(buildFloorPlanSceneGroups(buildSnapshot())).toHaveLength(1)
    textStepMock.mockResolvedValueOnce(mockTextCompletion(JSON.stringify({
      strategyOutput: {
        strategy: 'grid_coordinates',
        grid: { columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 },
        floorPlans: [],
      },
    })))

    const output = await generateGridFloorPlan({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot: buildSnapshot(),
    })

    expect(output.floorPlans).toEqual([])
  })

  it('returns no floor plans when no fixed-space scene groups exist', async () => {
    const snapshot = buildSnapshot({
      videoBlocks: [{
        ...buildSnapshot().videoBlocks[0],
        prompt: 'A fast chase montage through the courtyard.',
      }],
    })
    expect(buildFloorPlanSceneGroups(snapshot)).toEqual([])
    textStepMock.mockResolvedValueOnce(mockTextCompletion(JSON.stringify({
      strategyOutput: {
        strategy: 'grid_coordinates',
        grid: { columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 },
        floorPlans: [],
      },
    })))

    const output = await generateGridFloorPlan({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot,
    })

    expect(output.floorPlans).toEqual([])
  })

  it('requires overlay images for coordinate analysis and does not generate final panel prompts', async () => {
    await expect(analyzeGridCoordinates({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot: buildSnapshot(),
      floorPlanArtifacts: [],
      overlayImageUrls: [],
    })).rejects.toThrow('EDIT_SCRIPT_STORYBOARD_GRID_OVERLAY_IMAGE_REQUIRED')

    visionStepMock.mockResolvedValueOnce(mockVisionCompletion(JSON.stringify({
        strategyOutput: {
          strategy: 'grid_coordinates',
          blocks: [{
            sourceVideoBlockId: 'edit-1:videoBlock:1',
            classification: 'fixed_space_strong',
            grid: { columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 },
            coordinates: [
              { name: 'Old monk', kind: 'character', x: 6, y: 5, facing: 'east' },
              { name: 'Young disciple', kind: 'character', x: 9, y: 5, facing: 'west' },
            ],
            cinematicTranslation: 'Old monk stays screen left, disciple stays screen right, with the flower bed between them.',
            skipped: false,
            reason: 'Fixed dialogue blocking.',
          }],
        },
      })))

    const result = await analyzeGridCoordinates({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot: buildSnapshot(),
      floorPlanArtifacts: [{ id: 'artifact-1', kind: 'grid_coordinate_overlay' }],
      overlayImageUrls: ['https://cdn.example.com/overlay.png'],
    })

    expect(visionStepMock).toHaveBeenCalledWith(expect.objectContaining({
      imageUrls: ['https://cdn.example.com/overlay.png'],
    }))
    expect(result.strategyOutput).toMatchObject({
      blocks: [expect.objectContaining({
        cinematicTranslation: expect.stringContaining('screen left'),
      })],
    })
    expect('panels' in result).toBe(false)
  })

  it('uses a separate LLM camera plan to generate film-aesthetic panel prompts', async () => {
    textStepMock.mockResolvedValueOnce(mockTextCompletion(JSON.stringify({
      cameraStyleBible: {
        strategy: 'camera_style_bible',
        userDirectedCameraStyle: 'quiet restrained temple camera',
        inferredCameraStyle: 'observational natural light',
        cameraPhilosophy: 'restrained and relationship-focused',
        imageFilterPrompt: 'soft natural light, low contrast, subtle film grain',
        shotScaleProgression: 'medium close-up reverses preserve intimacy',
        compositionRules: ['use the flower bed as anchor'],
        movementRules: ['move only for emotional emphasis'],
        lensAndDepthRules: ['use mild telephoto shallow depth'],
        continuityRules: ['preserve eyeline and screen direction'],
        aestheticTone: 'calm intimacy',
        hardBans: ['no text'],
      },
    })))
    textStepMock.mockResolvedValueOnce(mockTextCompletion(JSON.stringify({
      cameraPlanBlockOutput: {
        sourceVideoBlockId: 'edit-1:videoBlock:1',
        panels: [
          {
            panelIndex: 0,
            sourceShotNumber: 1,
            sourceVideoBlockId: 'edit-1:videoBlock:1',
            shotScale: 'medium close-up',
            cameraPosition: 'over the disciple shoulder toward the old monk',
            cameraHeight: 'eye-level',
            cameraAngle: 'three-quarter frontal',
            composition: 'foreground shoulder frames the old monk, flower bed anchors the lower third',
            cameraMovement: 'slow push-in motivated by the old monk speaking gently',
            lensAndDepth: 'mild telephoto with shallow depth of field',
            screenDirection: 'old monk remains screen left, disciple remains screen right',
            aestheticIntent: 'quiet balanced composition emphasizes patient teaching',
            emotionalEffect: 'calm intimacy',
            continuityNote: 'preserve the dialogue axis and eyeline across the reverse shot',
            finalPanelPrompt: 'Medium close-up storyboard frame, soft natural light, low contrast, subtle film grain. Old monk speaks beside the flower bed, over the disciple shoulder, old monk screen left and disciple blurred foreground right, eye-level three-quarter frontal camera, balanced lower-third flower bed composition, slow push-in feeling, mild telephoto shallow depth of field, preserve eyeline and left-right continuity, no text, no watermarks.',
          },
          {
            panelIndex: 1,
            sourceShotNumber: 2,
            sourceVideoBlockId: 'edit-1:videoBlock:1',
            shotScale: 'reverse medium close-up',
            cameraPosition: 'over the old monk shoulder toward the young disciple',
            cameraHeight: 'eye-level',
            cameraAngle: 'three-quarter reverse',
            composition: 'old monk shoulder soft on left edge, disciple placed right of center',
            cameraMovement: 'static camera motivated by listening',
            lensAndDepth: 'mild telephoto with soft foreground shoulder',
            screenDirection: 'disciple remains screen right, old monk remains screen left',
            aestheticIntent: 'reverse composition keeps the teaching relationship stable',
            emotionalEffect: 'attentive humility',
            continuityNote: 'maintain the same axis and flower bed anchor',
            finalPanelPrompt: 'Reverse medium close-up storyboard frame, soft natural light, low contrast, subtle film grain. Young disciple listens and answers across the flower bed, old monk soft foreground shoulder on the left edge, disciple right of center, eye-level three-quarter reverse angle, static camera, mild telephoto shallow depth of field, preserve eyeline and left-right continuity, no text, no watermarks.',
          },
        ],
      },
    })))

    const result = await generateCameraPlan({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      snapshot: buildSnapshot(),
      coordinateStrategyOutput: {
        strategy: 'grid_coordinates',
        blocks: [
          {
            sourceVideoBlockId: 'edit-1:videoBlock:1',
            classification: 'fixed_space_strong',
            coordinates: [
              { name: 'Old monk', kind: 'character', x: 6, y: 5, facing: 'east' },
            ],
            cinematicTranslation: 'Old monk stays screen left, disciple stays screen right.',
            skipped: false,
          },
          {
            sourceVideoBlockId: 'edit-1:videoBlock:2',
            classification: 'no_fixed_space',
            coordinates: [],
            cinematicTranslation: 'No fixed-space blocking.',
            skipped: true,
          },
          {
            sourceVideoBlockId: 'edit-1:videoBlock:1',
            classification: 'fixed_space_weak',
            coordinates: [],
            cinematicTranslation: 'Empty coordinate result for the same block.',
            skipped: false,
          },
        ],
      },
    })

    expect(textStepMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'edit-script-storyboard-camera-style-bible',
    }))
    expect(textStepMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'edit-script-storyboard-camera-plan-block',
    }))
    const biblePromptInput = buildAiPromptMock.mock.calls[0]?.[0]
    const blockPromptInput = buildAiPromptMock.mock.calls[1]?.[0]
    if (!biblePromptInput?.variables || !blockPromptInput?.variables) throw new Error('PROMPT_INPUT_MISSING')
    const bibleCoordinateInput = JSON.parse(
      biblePromptInput.variables.coordinate_strategy_output_json,
    ) as { readonly blocks?: readonly { readonly sourceVideoBlockId?: string }[] }
    const blockCoordinateInput = JSON.parse(
      blockPromptInput.variables.coordinate_strategy_output_json,
    ) as { readonly blocks?: readonly { readonly sourceVideoBlockId?: string }[] }
    expect(bibleCoordinateInput.blocks?.map((block) => block.sourceVideoBlockId)).toEqual(['edit-1:videoBlock:1'])
    expect(blockCoordinateInput.blocks?.map((block) => block.sourceVideoBlockId)).toEqual(['edit-1:videoBlock:1'])
    expect(result.cameraStyleBible.userDirectedCameraStyle).toBe('quiet restrained temple camera')
    expect(result.cameraStyleBible.imageFilterPrompt).toBe('soft natural light, low contrast, subtle film grain')
    expect(blockPromptInput.variables.camera_style_bible_json).toContain('soft natural light, low contrast, subtle film grain')
    expect(result.cameraPlanOutput.panels[0]?.shotScale).toBe('medium close-up')
    expect(result.cameraPlanOutput.cameraStyleBible).toMatchObject({
      strategy: 'camera_style_bible',
    })
    expect(result.cameraPlanOutput.blocks).toHaveLength(1)
    expect(result.panels).toHaveLength(2)
    expect(result.panels[0]?.prompt).toContain('soft natural light, low contrast, subtle film grain')
    expect(result.panels[0]?.prompt).toContain('mild telephoto shallow depth of field')
    expect(result.panels[0]?.metadata).toMatchObject({
      source: 'camera_plan',
      strategy: 'grid_coordinates_camera_plan',
      cameraPlan: expect.objectContaining({
        composition: expect.stringContaining('flower bed'),
        aestheticIntent: expect.stringContaining('patient teaching'),
      }),
    })
  })
})
