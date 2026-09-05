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

const referenceAudioPrompt = `subject_definitions:
<Subject 1> (S1) is the person shown in <Picture 1>.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
<Subject 1> speaks one new line.

retention_analysis:
<Picture 1>: reference - preserve <Subject 1>.
<Audio 1>: reference - <Subject 1> (S1) follows its vocal timbre and measured delivery without copying the original signal.

detailed_description:
[Shot 1] <Subject 1> (S1) faces camera and says <d>[Chinese]这是新台词。</d>

overall_soundscape:
Clean speech with quiet room tone.

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

const continuationPrompt = referencePrompt
  .replace(
    '<Subject 1> is the woman in <Picture 1>.',
    '<Subject 1> is the established woman from the preceding motion guide.',
  )
  .replace(
    'Preserve her identity, clothing, and the room layout from <Picture 1>.',
    'Continue the inherited identity, pose, motion direction, and room layout from the preceding motion guide.',
  )

function assertH3Prompt(input: {
  readonly prompt: string
  readonly inputMode: 'reference' | 'first_frame' | 'first_last_frame' | 'continuation'
  readonly timelineDurationSeconds?: number
  readonly references?: {
    readonly pictureCount: number
    readonly audioCount: number
  }
}): void {
  assertVideoPromptMatchesProfile({
    profile: 'minimax_h3_multimodal_v3',
    prompt: input.prompt,
    inputMode: input.inputMode,
    timelineDurationSeconds: input.timelineDurationSeconds
      ?? (input.inputMode === 'continuation' ? 5.167 : 4.458),
    references: input.references ?? {
      pictureCount: input.inputMode === 'first_last_frame'
        ? 2
        : input.inputMode === 'continuation'
          ? 0
          : 1,
      audioCount: 0,
    },
  })
}

describe('MiniMax H3 multimodal Prompt contract', () => {
  it('keeps the exact six-section reference dialect without treating a reference as a frame', () => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: referencePrompt,
    })).not.toThrow()
  })

  it('binds one reference audio to one explicit subject and speaker identity', () => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: referenceAudioPrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('rejects media reference indexes above the frozen manifest', () => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: referenceAudioPrompt.replaceAll('<Audio 1>', '<Audio 2>'),
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:MEDIA_REFERENCE_INDEX_OUT_OF_RANGE:Audio:2')
  })

  it('rejects a frozen audio omitted from the prompt', () => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: referencePrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_MISSING:1')
  })

  it('rejects an audio definition without one subject and speaker binding', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      '<Audio 1> is the voice-timbre reference.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_BINDING_INVALID:1')
  })

  it('rejects one audio bound to two speaker identities', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1) and <Subject 2> (S2).',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_BINDING_INVALID:1')
  })

  it('rejects one audio token repeated on the same definition line', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      '<Audio 1> and <Audio 1> are the voice-timbre reference for <Subject 1> (S1).',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_BINDING_INVALID:1')
  })

  it('requires the audio-bound speaker in retention and dialogue', () => {
    const withoutRetention = referenceAudioPrompt.replace(
      '<Audio 1>: reference - <Subject 1> (S1) follows its vocal timbre and measured delivery without copying the original signal.',
      '<Audio 1>: reference - preserve the vocal timbre.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: withoutRetention,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_RETENTION_MISSING:1')

    const withoutDialogueSpeaker = referenceAudioPrompt.replace(
      '[Shot 1] <Subject 1> (S1) faces camera and says',
      '[Shot 1] The person faces camera and says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: withoutDialogueSpeaker,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_DIALOGUE_MISSING:1')
  })

  it('rejects dialogue owned only by a different subject and speaker', () => {
    const prompt = referenceAudioPrompt.replace(
      '[Shot 1] <Subject 1> (S1) faces camera and says <d>[Chinese]这是新台词。</d>',
      '[Shot 1] <Subject 1> (S1) watches while <Subject 2> (S2) says <d>[Chinese]这是新台词。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_DIALOGUE_MISSING:1')
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

  it('accepts continuation without inventing a Picture time anchor', () => {
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt: continuationPrompt,
    })).not.toThrow()
  })

  it('validates continuation shot times against the internal guide plus novel duration', () => {
    const promptWithTransition = continuationPrompt.replace(
      '[Shot 1] She notices the doorway, turns, and settles facing it.',
      '[Shot 1] Her inherited motion continues. [Shot 2] At 00:04.500, the camera cuts to the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt: promptWithTransition,
      timelineDurationSeconds: 5.167,
    })).not.toThrow()

    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt: promptWithTransition.replace('00:04.500', '00:05.167'),
      timelineDurationSeconds: 5.167,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:SHOT_TIME_OUT_OF_RANGE:2')
  })

  it('rejects a continuation shot transition inside the inherited guide interval', () => {
    const prompt = continuationPrompt.replace(
      '[Shot 1] She notices the doorway, turns, and settles facing it.',
      '[Shot 1] Her inherited motion continues. [Shot 2] At 00:00.500, the camera cuts to the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
      timelineDurationSeconds: 5.167,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:SHOT_TIME_OUT_OF_RANGE:2')
  })

  it('rejects a same-shot timed event inside the inherited guide interval', () => {
    const prompt = continuationPrompt.replace(
      '[Shot 1] She notices the doorway, turns, and settles facing it.',
      '[Shot 1] Her inherited motion continues. At 00:00.500, she turns toward the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
      timelineDurationSeconds: 5.167,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:TIMED_EVENT_OUT_OF_RANGE:00:00.500')
  })

  it.each([
    'at 0.500 seconds',
    'At 0.500 sec',
    'AT 0.500s',
    'at .500 s',
    'At 500ms',
    'at 00:00.500',
    'After 0.500 seconds',
    '0.500 seconds later',
    'At 00:00.5000',
    'At 0:00.500',
  ])('rejects non-canonical continuation time %s instead of bypassing the guide interval', (timeExpression) => {
    const prompt = continuationPrompt.replace(
      '[Shot 1] She notices the doorway, turns, and settles facing it.',
      `[Shot 1] Her inherited motion continues. ${timeExpression}, she turns toward the doorway.`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
      timelineDurationSeconds: 5.167,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:CONTINUATION_TIME_FORMAT_INVALID')
  })

  it('keeps time-like text inside dialogue opaque to continuation timing validation', () => {
    const prompt = continuationPrompt.replace(
      '[Shot 1] She notices the doorway, turns, and settles facing it.',
      '[Shot 1] She says <d>[English]Meet me at 0.500 seconds.</d> and turns toward the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
      timelineDurationSeconds: 5.167,
    })).not.toThrow()
  })

  it.each([
    ['summary', 'After 0.500 seconds she turns.'],
    ['retention_analysis', 'At 00:00.500, preserve her inherited motion.'],
  ])('rejects continuation timing instructions from the %s section', (section, value) => {
    const prompt = continuationPrompt.replace(
      new RegExp(`${section}:\\n[^\\n]+`, 'u'),
      `${section}:\n${value}`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
      timelineDurationSeconds: 5.167,
    })).toThrow(`VIDEO_PROMPT_PROFILE_INVALID:CONTINUATION_TIME_SECTION_INVALID:${section}`)
  })

  it('accepts a continuation timed event at the first millisecond after the guide interval', () => {
    const prompt = continuationPrompt.replace(
      '[Shot 1] She notices the doorway, turns, and settles facing it.',
      '[Shot 1] Her inherited motion continues. At 00:00.917, she turns toward the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
      timelineDurationSeconds: 5.167,
    })).not.toThrow()
  })

  it('forbids every Picture anchor in continuation mode', () => {
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt: continuationPrompt.replace('preceding motion guide.', '<Picture 1>.'),
      timelineDurationSeconds: 5.167,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:CONTINUATION_PICTURE_ANCHOR_FORBIDDEN')
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
      references: { pictureCount: 0, audioCount: 0 },
    })).not.toThrow()
  })
})
