import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ShotBlocking,
  StoryboardConsistencySourceSnapshot,
  StoryboardPanelPromptDraft,
} from '@/lib/edit-script/storyboard-consistency/types'

const prismaMock = vi.hoisted(() => ({
  projectCharacter: {
    findMany: vi.fn(),
  },
  projectStoryboard: {
    update: vi.fn(),
  },
  projectPanel: {
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function buildShotBlocking(): ShotBlocking {
  return {
    locationName: 'Temple courtyard',
    absolutePosition: 'old monk stands in the midground near the incense burner',
    relativePosition: 'old monk stands left of the disciple with the incense burner behind them',
    screenPosition: 'old monk screen left, disciple screen right',
    characterPlacements: [{
      characterName: 'Old monk',
      absolutePosition: 'midground near the incense burner',
      relativePosition: 'left of the disciple',
      screenPosition: 'screen left third',
      facing: 'toward screen right',
      eyeline: 'toward the disciple',
    }],
    cameraPlacement: 'front of courtyard looking toward the incense burner',
    composition: 'balanced two-person frame with incense burner as center anchor',
    continuityNote: 'preserve monk-left disciple-right axis',
  }
}

function buildSourceSnapshot(): StoryboardConsistencySourceSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceEditScriptId: 'edit-script-1',
    project: {
      videoRatio: '16:9',
    },
    editScript: {
      id: 'edit-script-1',
      title: 'Temple Lesson',
      logline: null,
      durationSec: 8,
      shotCount: 1,
      userPrompt: 'temple lesson',
      screenplayText: null,
    },
    styleBible: {
      strategy: 'style_bible',
      rawUserStyle: 'temple lesson',
      styleSummary: 'quiet temple style',
      stylePolicy: {
        visual: {
          negativePrompt: 'no text',
          imageFilterPrompt: 'soft natural light',
          lightingPrompt: 'soft light',
          colorPrompt: 'muted colors',
          texturePrompt: 'stone and wood',
          compositionPrompt: 'balanced frame',
        },
        camera: {
          movementPrompt: 'static',
          lensAndDepthPrompt: '35mm natural depth',
          videoRhythmPrompt: 'slow rhythm',
        },
        directing: {
          pointOfViewPrompt: 'restricted protagonist viewpoint',
          performancePrompt: 'restrained performance through small gestures',
          informationReleasePrompt: 'reveal information through reaction before event truth',
          rhythmPrompt: 'hold suspense pauses before faster turns',
        },
        sound: {
          soundFilterPrompt: 'quiet wind',
        },
        hardBans: ['no text'],
      },
    },
    shots: [{
      shotNumber: 1,
      durationSec: 8,
      dramaticPurpose: 'teach the lesson',
      visibleAction: 'Old monk teaches the young disciple.',
      audienceFocus: 'the old monk',
      viewpoint: 'observer',
      revealPlan: 'show relationship',
      performanceBeat: 'restrained gesture',
      continuityIn: 'enter calm space',
      continuityOut: 'hold the same axis',
      charactersAndScene: 'Temple courtyard',
      sound: 'wind',
    }],
    directorDecoupage: {
      shots: [{
        shotNumber: 1,
        durationSec: 8,
        dramaticPurpose: 'teach the lesson',
        visibleAction: 'Old monk teaches the young disciple.',
        audienceFocus: 'the old monk',
        viewpoint: 'observer',
        revealPlan: 'show relationship',
        performanceBeat: 'restrained gesture',
        continuityIn: 'enter calm space',
        continuityOut: 'hold the same axis',
        charactersAndScene: 'Temple courtyard',
        sound: 'wind',
      }],
      hardBans: ['no text'],
    },
    cinematographyShotPlan: {
      shots: [{
        shotNumber: 1,
        shotScale: 'medium shot',
        lens: '35mm',
        depthOfField: 'moderate depth',
        cameraPosition: 'front of courtyard',
        cameraHeight: 'eye level',
        cameraAngle: 'neutral',
        movement: 'static',
        composition: 'balanced two-person frame',
        lighting: 'soft natural light',
        axisAndEyeline: 'monk left, disciple right',
        continuityIn: 'enter calm space',
        continuityOut: 'hold the same axis',
      }],
      hardBans: ['no text'],
    },
    videoBlocks: [{
      kind: 'single',
      shotNumbers: [1],
      reason: 'single teaching beat',
      prompt: 'Temple lesson.',
      blockIndex: 0,
      sourceVideoBlockId: 'edit-script-1:videoBlock:1',
    }],
    assets: [],
  }
}

describe('edit-script storyboard persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectCharacter.findMany.mockResolvedValue([])
    prismaMock.projectStoryboard.update.mockResolvedValue({ panels: [] })
    prismaMock.projectPanel.create.mockResolvedValue({ id: 'panel-1', panelIndex: 0 })
  })

  it('persists shotBlocking into panel photographyRules.cameraPlan', async () => {
    const { upsertStoryboardPanelsFromPrompts } = await import('@/lib/edit-script/storyboard-consistency/persistence')
    const shotBlocking = buildShotBlocking()
    const generatedPanels: StoryboardPanelPromptDraft[] = [{
      panelIndex: 0,
      sourceShotNumber: 1,
      sourceVideoBlockId: 'edit-script-1:videoBlock:1',
      prompt: 'cinematic storyboard image prompt for the temple courtyard teaching moment',
      videoPrompt: 'eight second locked camera video prompt for the temple courtyard teaching moment',
      shotBlocking,
      metadata: {
        source: 'camera_plan',
        strategy: 'spatial_text_blocking',
        cameraPlan: {
          shotScale: 'medium shot',
          cameraPosition: 'front of courtyard',
          shotBlocking,
        },
      },
    }]

    await upsertStoryboardPanelsFromPrompts({
      storyboardId: 'storyboard-1',
      snapshot: buildSourceSnapshot(),
      generatedPanels,
      locale: 'en',
    })

    const createCalls = prismaMock.projectPanel.create.mock.calls as Array<[{
      readonly data: {
        readonly photographyRules?: string | null
      }
    }]>
    const photographyRules = JSON.parse(String(createCalls[0]?.[0].data.photographyRules)) as Record<string, unknown>

    expect(photographyRules.cameraPlan).toMatchObject({
      shotScale: 'medium shot',
      cameraPosition: 'front of courtyard',
      shotBlocking,
    })
    expect(photographyRules.consistencyMetadata).toMatchObject({
      cameraPlan: {
        shotBlocking,
      },
    })
  })
})
