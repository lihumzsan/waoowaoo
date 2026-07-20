import { describe, expect, it } from 'vitest'
import { buildVideoSegmentPrompt } from '@/lib/video-segments/prompt'
import type {
  EditGenerationSegment,
  EditGenerationSegmentExecution,
  EditScriptShot,
} from '@/lib/edit-script/types'
import type { EditScriptDialogueVoiceContext } from '@/lib/edit-script/voice-profiles'

// Test governance: Logic test for the deterministic prompt compiler. The oracle is the
// emitted AUDIO TIMELINE; it rejects dropping a Segment cue or duplicating dialogue text.
describe('video Segment prompt audio timeline', () => {
  it('compiles an optional sound lead into the Segment prompt without duplicating dialogue', () => {
    const shots: readonly EditScriptShot[] = [
      {
        shotId: 'shot-1',
        shotNumber: 1,
        shotPurpose: 'insert',
        durationSec: 2,
        scene: { locationId: 'location-cafe', name: 'Cafe', subScene: 'coffee cup on the table' },
        action: 'A coffee cup rests in the foreground while someone listens offscreen.',
        characters: [],
        dialogue: [],
        synchronousSound: 'Cup placed on the table.',
      },
      {
        shotId: 'shot-2',
        shotNumber: 2,
        shotPurpose: 'reaction',
        durationSec: 3,
        scene: { locationId: 'location-cafe', name: 'Cafe', subScene: 'the woman across the table' },
        action: 'The camera reveals the woman speaking across the table.',
        characters: [{ characterId: 'character-woman', name: 'Woman', performance: 'holds her gaze on the listener' }],
        dialogue: [{ characterId: 'character-woman', line: 'Are you really leaving?' }],
        synchronousSound: 'Soft cafe room tone.',
      },
    ]
    const segment: EditGenerationSegment = {
      segmentId: 'segment-1',
      shotIds: ['shot-1', 'shot-2'],
      continuity: 'The same cafe conversation continues through the reveal.',
      soundCues: [{
        kind: 'dialogue',
        description: 'The woman speaks offscreen over the coffee-cup detail before the reveal.',
        startSec: 0,
        endSec: 3,
        sourceShotId: 'shot-2',
      }],
    }
    const execution: EditGenerationSegmentExecution = {
      segmentId: 'segment-1',
      shots: [
        { shotId: 'shot-1', shotNumber: 1, shotScale: 'close-up', cameraMovement: { movement: 'locked off', stability: 'locked' } },
        { shotId: 'shot-2', shotNumber: 2, shotScale: 'medium', cameraMovement: { movement: 'slow reveal', stability: 'smooth' } },
      ],
    }
    const voiceContext: EditScriptDialogueVoiceContext = {
      characters: [{ characterId: 'character-woman', name: 'Woman', voiceProfile: 'warm contralto' }],
      shots: [{
        shotId: 'shot-2',
        shotNumber: 2,
        dialogue: [{
          characterId: 'character-woman',
          name: 'Woman',
          voiceProfile: 'warm contralto',
          line: 'Are you really leaving?',
        }],
      }],
    }

    const prompt = buildVideoSegmentPrompt({
      visualStyle: 'Naturalistic cinematic cafe drama.',
      segment,
      execution,
      shots,
      references: [],
      voiceContext,
    })

    expect(prompt).toContain('AUDIO TIMELINE')
    expect(prompt).toContain('0s-3s | dialogue cue | leads before the visual source of Shot 2 is revealed')
    expect(prompt).toContain('use the exact dialogue and intrinsic voice listed in Shot 2')
    expect(prompt.match(/Are you really leaving\?/g)).toHaveLength(1)
  })
})
