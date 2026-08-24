import { describe, expect, it } from 'vitest'
import { assertVideoPromptMatchesProfile } from '@/lib/video-generation/h3-prompt'

const referencePrompt = `subject_definitions:
<Subject 1> is the woman in <Picture 1>.

summary:
She turns toward the doorway.

retention_analysis:
Preserve her identity, clothing, and the room layout from <Picture 1>.

detailed_description:
At 0.00 seconds she notices the doorway, turns, and settles facing it.

overall_soundscape:
Soft room tone, fabric movement, and her quiet breath.

non_diegetic_music:
N/A`

const firstFramePrompt = referencePrompt.replace(
  'At 0.00 seconds she notices the doorway',
  'At 0.00 seconds, <Picture 1> is the exact opening frame; she notices the doorway',
)

const firstLastFramePrompt = firstFramePrompt.replace(
  'turns, and settles facing it.',
  'turns, and at 4.00 seconds settles exactly into <Picture 2>.',
)

function assertH3Prompt(input: {
  readonly prompt: string
  readonly inputMode: 'reference' | 'first_frame' | 'first_last_frame'
  readonly durationSeconds?: number
}): void {
  assertVideoPromptMatchesProfile({
    profile: 'minimax_h3_multimodal_v3',
    prompt: input.prompt,
    inputMode: input.inputMode,
    durationSeconds: input.durationSeconds ?? 4,
  })
}

describe('MiniMax H3 multimodal Prompt contract', () => {
  it('keeps the exact six-section reference dialect without treating a reference as a frame', () => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: referencePrompt,
    })).not.toThrow()
  })

  it('requires Picture 1 to be the explicit 0.00-second anchor in first-frame mode', () => {
    expect(() => assertH3Prompt({
      inputMode: 'first_frame',
      prompt: firstFramePrompt,
    })).not.toThrow()

    expect(() => assertH3Prompt({
      inputMode: 'first_frame',
      prompt: referencePrompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:FIRST_FRAME_ANCHOR_REQUIRED')
  })

  it('requires Picture 2 to match the frozen segment end in first-last-frame mode', () => {
    expect(() => assertH3Prompt({
      inputMode: 'first_last_frame',
      prompt: firstLastFramePrompt,
      durationSeconds: 4,
    })).not.toThrow()

    expect(() => assertH3Prompt({
      inputMode: 'first_last_frame',
      prompt: firstLastFramePrompt,
      durationSeconds: 6,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:LAST_FRAME_ANCHOR_REQUIRED')
  })

  it.each([
    referencePrompt.replace('retention_analysis:', 'retention_notes:'),
    referencePrompt.replace('summary:\nShe turns toward the doorway.\n\n', 'summary:\n\n'),
    referencePrompt.replace('N/A', 'Use a dramatic orchestral score.'),
    referencePrompt + '\nunknown_heading:\nextra',
  ])('rejects an invalid six-section H3 Prompt', (prompt) => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID')
  })

  it('rejects the old prose music clause after the fixed N/A migration', () => {
    const contradictory = referencePrompt.replace(
      'N/A',
      'None. Do not generate background music or musical score.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: contradictory,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID')
  })

  it('leaves generic profile validation to its own dialect', () => {
    expect(() => assertVideoPromptMatchesProfile({
      profile: 'generic_v1',
      prompt: 'anything',
      inputMode: 'text_to_video',
      durationSeconds: 4,
    })).not.toThrow()
  })
})
