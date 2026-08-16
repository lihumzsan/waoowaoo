import { describe, expect, it } from 'vitest'
import { assertVideoPromptMatchesProfile } from '@/lib/video-generation/h3-reference-prompt'

const validPrompt = `subject_definitions:
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
None. Do not generate background music or musical score.
Retain only dialogue, environmental ambience and action sound effects.`

describe('MiniMax H3 reference Prompt contract', () => {
  it('accepts the exact six ordered sections and no-background-music clause', () => {
    expect(() => assertVideoPromptMatchesProfile({
      profile: 'minimax_h3_reference_v2',
      prompt: validPrompt,
    })).not.toThrow()
  })

  it.each([
    validPrompt.replace('retention_analysis:', 'retention_notes:'),
    validPrompt.replace('summary:\nShe turns toward the doorway.\n\n', 'summary:\n\n'),
    validPrompt.replace('Do not generate background music or musical score.', 'Use a dramatic orchestral score.'),
    `${validPrompt}\nunknown_heading:\nextra`,
  ])('rejects an invalid reference Prompt', (prompt) => {
    expect(() => assertVideoPromptMatchesProfile({
      profile: 'minimax_h3_reference_v2',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID')
  })

  it('leaves generic profile validation to its own dialect', () => {
    expect(() => assertVideoPromptMatchesProfile({ profile: 'generic_v1', prompt: 'anything' })).not.toThrow()
  })
})
