import { describe, expect, it } from 'vitest'
import { assertVideoPromptMatchesProfile } from '@/lib/video-generation/h3-prompt'

const referencePrompt = `subject_definitions:
<Subject 1> is the woman in <Picture 1>.

summary:
She turns toward the doorway.

retention_analysis:
Preserve her identity, clothing, and the room layout from <Picture 1>.

detailed_description:
[Shot 1] She notices the doorway, turns, and settles facing it.

overall_soundscape:
Soft room tone, fabric movement, and her quiet breath.

non_diegetic_music:
N/A`

const firstFramePrompt = referencePrompt.replace(
  '[Shot 1] She notices the doorway',
  '[Shot 1] <Picture 1> aligns with 0.00 seconds and shows her noticing the doorway',
)

const firstLastFramePrompt = firstFramePrompt.replace(
  'turns, and settles facing it.',
  'turns, and at 4.458 seconds settles exactly into <Picture 2>.',
)

function assertH3Prompt(input: {
  readonly prompt: string
  readonly inputMode: 'reference' | 'first_frame' | 'first_last_frame'
  readonly timelineDurationSeconds?: number
}): void {
  assertVideoPromptMatchesProfile({
    profile: 'minimax_h3_multimodal_v3',
    prompt: input.prompt,
    inputMode: input.inputMode,
    timelineDurationSeconds: input.timelineDurationSeconds ?? 4.458,
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
      timelineDurationSeconds: 4.458,
    })).not.toThrow()

    expect(() => assertH3Prompt({
      inputMode: 'first_last_frame',
      prompt: firstLastFramePrompt,
      timelineDurationSeconds: 6.583,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:LAST_FRAME_ANCHOR_REQUIRED')
  })

  it('allows dialogue in first-last-frame mode when the user requires frame control', () => {
    const dialoguePrompt = firstLastFramePrompt.replace(
      'turns, and at 4.458 seconds',
      'says: <d>[Chinese]不要走。</d>, turns, and at 4.458 seconds',
    )
    expect(() => assertH3Prompt({
      inputMode: 'first_last_frame',
      prompt: dialoguePrompt,
      timelineDurationSeconds: 4.458,
    })).not.toThrow()
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

  it.each([
    {
      name: 'a detailed description without the required first shot marker',
      prompt: referencePrompt.replace('[Shot 1] ', ''),
      reason: 'DETAILED_DESCRIPTION_SHOT_1_REQUIRED',
    },
    {
      name: 'a dialogue tag outside detailed_description',
      prompt: referencePrompt.replace(
        'She turns toward the doorway.',
        'She speaks the provided line. <d>[Chinese]不要走。</d>',
      ),
      reason: 'DIALOGUE_TAG_SECTION_INVALID:summary',
    },
    {
      name: 'the unsupported dialogue cutoff tag',
      prompt: referencePrompt.replace(
        'turns, and settles',
        'says: <d>[Chinese]不要<cutoff></d>, turns, and settles',
      ),
      reason: 'DIALOGUE_CUTOFF_UNSUPPORTED',
    },
  ])('rejects $name', ({ prompt, reason }) => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow(`VIDEO_PROMPT_PROFILE_INVALID:${reason}`)
  })

  it('treats verbatim dialogue as opaque to shot syntax validation', () => {
    const prompt = referencePrompt.replace(
      'she notices the doorway, turns, and settles facing it.',
      'she says: <d>[English]The camera cuts to [Shot 2].</d> and settles facing the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it.each([
    {
      name: 'a skipped shot number',
      detail: '[Shot 1] She turns. [Shot 3] At 00:02.000, the camera cuts to the doorway.',
      reason: 'SHOT_SEQUENCE_INVALID:2',
    },
    {
      name: 'a cut announced before the next shot marker',
      detail: '[Shot 1] She turns. At 00:02.000, the camera cuts to the doorway. [Shot 2] She settles.',
      reason: 'SHOT_TRANSITION_INVALID:2',
    },
    {
      name: 'a cut at the exact segment end',
      detail: '[Shot 1] She turns. [Shot 2] At 00:04.458, the camera cuts to the doorway.',
      reason: 'SHOT_TIME_OUT_OF_RANGE:2',
    },
    {
      name: 'a second shot at the exact segment start',
      detail: '[Shot 1] She turns. [Shot 2] At 00:00.000, the camera cuts to the doorway.',
      reason: 'SHOT_TIME_OUT_OF_RANGE:2',
    },
  ])('rejects $name', ({ detail, reason }) => {
    const prompt = referencePrompt.replace(
      '[Shot 1] She notices the doorway, turns, and settles facing it.',
      detail,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow(`VIDEO_PROMPT_PROFILE_INVALID:${reason}`)
  })

  it('leaves generic profile validation to its own dialect', () => {
    expect(() => assertVideoPromptMatchesProfile({
      profile: 'generic_v1',
      prompt: 'anything',
      inputMode: 'text_to_video',
      timelineDurationSeconds: 4.458,
    })).not.toThrow()
  })
})
