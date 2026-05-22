import { describe, expect, it } from 'vitest'
import { assertRequiredLocationPreviews } from '@/lib/edit-script/storyboard-consistency/service'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'

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

function buildSourceSnapshot(overrides: Partial<StoryboardConsistencySourceSnapshot> = {}): StoryboardConsistencySourceSnapshot {
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
        visualAction: 'Old monk speaks to a young disciple in the temple courtyard.',
        charactersAndScene: 'Old monk and young disciple in the temple courtyard.',
        camera: 'medium shot',
        videoPrompt: 'Two-person courtyard dialogue.',
        sound: 'quiet wind',
      },
      {
        shotNumber: 2,
        durationSec: 5,
        visualAction: 'Young disciple replies while keeping the same spatial relation.',
        charactersAndScene: 'Young disciple and old monk in the temple courtyard.',
        camera: 'reverse medium shot',
        videoPrompt: 'Reverse courtyard dialogue.',
        sound: 'soft reply',
      },
    ],
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
  it('does not block floor-plan suitability analysis before the model can return empty plans', () => {
    expect(() => assertRequiredLocationPreviews({
      sourceSnapshot: buildSourceSnapshot(),
    })).not.toThrow()
  })

  it('allows floor-plan suitability analysis when the matching scene reference image exists', () => {
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
