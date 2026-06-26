import { describe, expect, it } from 'vitest'
import { assertRequiredLocationPreviews } from '@/lib/edit-script/storyboard-consistency/service'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'

function buildStyleBible(): StoryboardConsistencySourceSnapshot['styleBible'] {
  return {
    strategy: 'style_bible',
    rawUserStyle: 'temple lesson',
    styleSummary: 'Restrained naturalistic temple visual style.',
    stylePolicy: {
      visual: {
        imageFilterPrompt: 'soft natural light, low contrast, quiet temple textures',
        lightingPrompt: 'Soft diffused daylight.',
        colorPrompt: 'Muted stone, wood, and gray green.',
        texturePrompt: 'Stone, wood, linen, and fine film grain.',
        compositionPrompt: 'Stable balanced composition.',
      },
      camera: {
        movementPrompt: 'Locked camera and slow push-in.',
        lensAndDepthPrompt: '35mm lens, natural depth.',
        videoRhythmPrompt: 'Slow rhythm. Restrained pacing.',
      },
      directing: {
        pointOfViewPrompt: 'restricted protagonist viewpoint',
        performancePrompt: 'restrained performance through small gestures',
        informationReleasePrompt: 'reveal information through reaction before event truth',
        rhythmPrompt: 'hold suspense pauses before faster turns',
      },
      sound: {
        soundFilterPrompt: 'soft natural low dynamic sound',
      },
    },
  }
}

function buildSourceSnapshot(overrides: Partial<StoryboardConsistencySourceSnapshot> = {}): StoryboardConsistencySourceSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    episodeId: 'episode-1',
    project: {
      videoRatio: '16:9',
    },
    editScript: {
      id: 'edit-1',
      title: 'Temple Lesson',
      logline: 'A monk teaches a disciple.',
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
        dramaticPurpose: 'test dramatic purpose',
        visibleAction: 'Old monk speaks to a young disciple in the temple courtyard.',
        audienceFocus: 'test audience focus',
        viewpoint: 'test viewpoint',
        revealPlan: 'test reveal plan',
        performanceBeat: 'test performance beat',
        continuityIn: 'test continuity in',
        continuityOut: 'test continuity out',
        charactersAndScene: 'Old monk and young disciple in the temple courtyard.',
        sound: 'quiet wind',
      },
      {
        shotNumber: 2,
        durationSec: 5,
        dramaticPurpose: 'test dramatic purpose',
        visibleAction: 'Young disciple replies while keeping the same spatial relation.',
        audienceFocus: 'test audience focus',
        viewpoint: 'test viewpoint',
        revealPlan: 'test reveal plan',
        performanceBeat: 'test performance beat',
        continuityIn: 'test continuity in',
        continuityOut: 'test continuity out',
        charactersAndScene: 'Young disciple and old monk in the temple courtyard.',
        sound: 'soft reply',
      },
    ],
    directorDecoupage: {
      shots: [
        {
          shotNumber: 1,
          durationSec: 5,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Old monk speaks to a young disciple in the temple courtyard.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Old monk and young disciple in the temple courtyard.',
          sound: 'quiet wind',
        },
        {
          shotNumber: 2,
          durationSec: 5,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Young disciple replies while keeping the same spatial relation.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Young disciple and old monk in the temple courtyard.',
          sound: 'soft reply',
        },
      ],
    },
    cinematographyShotPlan: {
      shots: [
        {
          shotNumber: 1,
          shotScale: 'medium shot',
          lens: '35mm',
          depthOfField: 'moderate depth',
          cameraPosition: 'courtyard front',
          cameraHeight: 'eye level',
          cameraAngle: 'neutral',
          movement: 'static',
          composition: 'monk left, disciple right',
          lighting: 'soft natural light',
          axisAndEyeline: 'left-right dialogue axis',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
        },
        {
          shotNumber: 2,
          shotScale: 'medium shot',
          lens: '35mm',
          depthOfField: 'moderate depth',
          cameraPosition: 'courtyard front',
          cameraHeight: 'eye level',
          cameraAngle: 'neutral',
          movement: 'static',
          composition: 'disciple right, monk left',
          lighting: 'soft natural light',
          axisAndEyeline: 'left-right dialogue axis',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
        },
      ],
    },
    videoBlocks: [
      {
        kind: 'group',
        shotNumbers: [1, 2],
        reason: 'two-person dialogue in one fixed courtyard',
        prompt: 'A two-person dialogue in the same temple courtyard.',
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
    ],
    ...overrides,
  }
}

describe('storyboard consistency service prechecks', () => {
  it('does not block spatial blocking preparation when only character assets are present', () => {
    expect(() => assertRequiredLocationPreviews({
      sourceSnapshot: buildSourceSnapshot(),
    })).not.toThrow()
  })

  it('allows spatial blocking preparation when the matching scene reference image exists', () => {
    expect(() => assertRequiredLocationPreviews({
      sourceSnapshot: buildSourceSnapshot({
        assets: [
          ...buildSourceSnapshot().assets,
          {
            requirementId: 'loc-1',
            kind: 'location',
            name: 'Temple courtyard',
            description: 'courtyard with a flower bed',
            shotNumbers: [1, 2],
            targetId: 'location-1',
            previewImageUrl: 'https://cdn.example.com/courtyard.png',
          },
        ],
      }),
    })).not.toThrow()
  })
})
