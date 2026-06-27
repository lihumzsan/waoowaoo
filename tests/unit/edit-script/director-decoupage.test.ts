import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { editDirectorDecoupageSchema } from '@/lib/edit-script/types'

describe('edit script director decoupage', () => {
  it('accepts a complete director shot list with continuity and viewpoint fields', () => {
    const parsed = editDirectorDecoupageSchema.parse({
      shots: [
        {
          shotNumber: 1,
          durationSec: 3,
          dramaticPurpose: 'Establish the protagonist hesitation before entering the room.',
          visibleAction: 'The protagonist stops at the doorway and does not push the door immediately.',
          audienceFocus: 'The trembling hand and the dark door gap.',
          viewpoint: 'Restricted protagonist viewpoint.',
          revealPlan: 'Hide the inside of the room and release only unease.',
          performanceBeat: 'Fear is suppressed through fingers and breathing.',
          continuityIn: 'Begins from footsteps stopping.',
          continuityOut: 'Leads along the protagonist eyeline toward the door.',
          charactersAndScene: 'Protagonist outside the door; the room interior is unseen.',
          sound: 'Footsteps stop and a low tone comes from inside the room.',
        },
      ],
    })

    expect(parsed.shots[0]?.viewpoint).toBe('Restricted protagonist viewpoint.')
    expect(parsed.shots[0]?.continuityOut).toContain('eyeline')
    expect(Object.prototype.hasOwnProperty.call(parsed, 'hardBans')).toBe(false)
  })

  it('rejects director decoupage that omits audience focus', () => {
    const result = editDirectorDecoupageSchema.safeParse({
      shots: [
        {
          shotNumber: 1,
          durationSec: 3,
          dramaticPurpose: 'Establish hesitation.',
          visibleAction: 'The protagonist waits at the door.',
          viewpoint: 'Restricted protagonist viewpoint.',
          revealPlan: 'Hide the room.',
          performanceBeat: 'Small breath.',
          continuityIn: 'Opening shot.',
          continuityOut: 'Continue toward the door.',
          charactersAndScene: 'Protagonist outside the door.',
          sound: 'Low room tone.',
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('prompts the director module to decide shot purpose without concrete cinematography parameters', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_DIRECTOR_DECOUPAGE,
      locale: 'en',
      variables: {
        user_request: 'Create a restrained suspense short.',
        screenplay_text: 'A protagonist approaches a closed door.',
        style_bible_json: JSON.stringify({ stylePolicy: { directing: {}, camera: {}, visual: {}, sound: {} } }),
        duration_guidance: 'Short duration tier, around 30 seconds. Keep it to one compact event; the final total duration may naturally land around 20-40 seconds instead of mechanically matching an exact second count.',
        aspect_ratio: '9:16',
      },
    })

    expect(prompt).toContain('Director Decoupage')
    expect(prompt).toContain('dramaticPurpose')
    expect(prompt).toContain('audienceFocus')
    expect(prompt).toContain('continuityIn')
    expect(prompt).toContain('Do not output lens, camera position, depth of field, concrete composition')
    expect(prompt).not.toContain('hardBans')
  })
})
