import { describe, expect, it } from 'vitest'
import { assertVideoPromptMatchesProfile } from '@/lib/video-generation/h3-prompt'

const REFERENCE_STYLE_OPENING = 'The target video uses a realistic cinematic style with natural indoor lighting.'

const referencePrompt = `subject_definitions:
<Subject 1> is the woman in <Picture 1>.

summary:
[reference generation] She turns toward the doorway while preserving <Subject 1> from <Picture 1>.


retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - Her identity, clothing, and the room layout from <Picture 1> are retained.

detailed_description:
${REFERENCE_STYLE_OPENING}
[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.

overall_soundscape:
Soft room tone, fabric movement, and her quiet breath.

non_diegetic_music:
N/A`

const referenceAudioPrompt = `subject_definitions:
<Subject 1> (S1) is the person shown in <Picture 1>.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.


retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - The person's identity and appearance from <Picture 1> are retained.
<Audio 1>: reference - The target speaker follows <Audio 1>'s vocal timbre and measured delivery without copying the original signal.

detailed_description:
The target video uses a realistic cinematic portrait style with natural indoor lighting.
[Shot 1] <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>

overall_soundscape:
Clean speech with quiet room tone.

non_diegetic_music:
N/A`

const nonReferencePrompt = referencePrompt
  .replace('[reference generation] ', '')
  .replace(`${REFERENCE_STYLE_OPENING}\n`, '')

const firstFramePrompt = nonReferencePrompt.replace(
  '[Shot 1] <Subject 1> notices the doorway',
  '[Shot 1] <Picture 1> aligns with 0.00 seconds and shows her noticing the doorway',
)

const firstLastFramePrompt = firstFramePrompt.replace(
  'turns, and settles facing it.',
  'turns, and at 4.458 seconds settles exactly into <Picture 2>.',
)

const continuationPrompt = nonReferencePrompt
  .replace(
    '<Subject 1> is the woman in <Picture 1>.',
    '<Subject 1> is the established woman from the preceding motion guide.',
  )
  .replace(
    'She turns toward the doorway while preserving <Subject 1> from <Picture 1>.',
    'She continues the inherited motion toward the doorway.',
  )
  .replace(
    '<Subject 1> (appears in [Shot 1]): fully_preserved - Her identity, clothing, and the room layout from <Picture 1> are retained.',
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
  // Oracle: MiniMaxAI/MiniMax-H3 docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md,
  // sections 2, 4 and 5, plus the project's no-unused-conditioning-input rule.
  describe('visual reference closure', () => {
    const prompt = referencePrompt.replace('[Shot 1] She', '[Shot 1] <Subject 1>')
    const definition = '<Subject 1> is the woman in <Picture 1>.'
    const retention = '<Subject 1> (appears in [Shot 1]): fully_preserved - Her identity, clothing, and the room layout from <Picture 1> are retained.'

    it('rejects supplied pictures without a declared reference role', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference', prompt, references: { pictureCount: 9, audioCount: 0 },
      })).toThrow('REFERENCE_PICTURE_UNUSED:2')
    })

    it('requires the source picture in a referenced Subject definition', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference', prompt: prompt.replace(definition, '<Subject 1> is the woman in the room.'),
      })).toThrow('REFERENCE_SUBJECT_SOURCE_MISSING:1')
    })

    it('does not count a visible-text literal as a source picture binding', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt: prompt.replace(definition, '<Subject 1> is a woman holding a sign bearing visible text reading "<Picture 1>".'),
      })).toThrow('REFERENCE_SUBJECT_SOURCE_MISSING:1')
    })

    it('requires a retention entry owned by the defined Subject', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt: prompt.replace(retention, '<Picture 1>: weak_reference - The composition guides the shot.'),
      })).toThrow('REFERENCE_VISUAL_RETENTION_MISSING:Subject:1')
    })

    it('rejects two retention relationships for the same Subject', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference', prompt: prompt.replace(retention, `${retention}\n${retention}`),
      })).toThrow('REFERENCE_VISUAL_RETENTION_DUPLICATE:Subject:1')
    })

    it('requires the referenced Subject to apply in the description, not only the summary', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference', prompt: referencePrompt.replace('[Shot 1] <Subject 1>', '[Shot 1] She'),
      }))
        .toThrow('REFERENCE_VISUAL_APPLICATION_MISSING:Subject:1')
    })

    it('does not count a displayed Subject token as an application', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt: prompt.replace('[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.', '[Shot 1] A sign reading "<Subject 1>" hangs above the doorway.'),
      })).toThrow('REFERENCE_VISUAL_APPLICATION_MISSING:Subject:1')
    })

    it('rejects a retention scope naming a nonexistent shot', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference', prompt: prompt.replace('(appears in [Shot 1])', '(appears in [Shot 3])'),
      })).toThrow('REFERENCE_VISUAL_RETENTION_SHOT_INVALID:Subject:1:3')
    })

    it('allows multiple pictures to define one Subject without standalone Picture entries', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt: prompt.replace(definition, '<Subject 1> is the woman seen from the front in <Picture 1> and from the side in <Picture 2>.'),
        references: { pictureCount: 2, audioCount: 0 },
      })).not.toThrow()
    })

    it('allows one picture to supply multiple independently retained Subjects', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt: prompt.replace(definition, `${definition}\n<Subject 2> is the doorway in <Picture 1>.`)
          .replace(retention, `${retention}\n<Subject 2>: fully_preserved - The doorway keeps its wooden frame.`)
          .replace('[Shot 1] <Subject 1> notices the doorway', '[Shot 1] <Subject 1> notices <Subject 2>'),
      })).not.toThrow()
    })

    it('allows a standalone composition anchor without inventing a Subject', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt: prompt.replace(definition, '<Picture 1> is the composition reference for [Shot 1].')
          .replaceAll('<Subject 1>', '<Picture 1>')
          .replace('[Shot 1] <Picture 1> notices the doorway, turns, and settles facing it.', '[Shot 1] The composition follows <Picture 1> as the woman turns toward the doorway.'),
      })).not.toThrow()
    })

    it.each(['partially_preserved', 'attribute_transfer', 'weak_reference'])(
      'does not force a legal %s relationship into full preservation', (relationship) => {
        expect(() => assertH3Prompt({
          inputMode: 'reference', prompt: prompt.replace('fully_preserved', relationship),
        })).not.toThrow()
      },
    )

    it('allows a style Subject to apply in the global style opening', () => {
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt: prompt.replace(definition, `${definition}\n<Subject 2> is the soft lighting style in <Picture 1>.`)
          .replace(retention, `${retention}\n<Subject 2>: weak_reference - The lighting guides the whole video.`)
          .replace(REFERENCE_STYLE_OPENING, 'The target video uses the realistic cinematic style of <Subject 2>.'),
      })).not.toThrow()
    })
  })

  describe('no-subtitle intent and literal boundaries', () => {
    // Oracle: literal source content is opaque to direction parsing (Ref guide §5).
    // Product policy forbids rendering speech/lyrics, not physical signage.
    function withDirection(direction: string): string {
      return referenceAudioPrompt.replace(
        '<d>[Chinese]这是新台词。</d>',
        `<d>[Chinese]这是新台词。</d> ${direction}`,
      )
    }

    it.each([
      'No captions are displayed, but add subtitles below.',
      'Do not omit subtitles.',
      'No captions are displayed. Add subtitles below.',
      'The bottom of the screen displays visible text reading "This is a new line." synchronized with her speech.',
      'Text reading "This is a new line." appears in sync with the spoken dialogue.',
      'Text reading "This is a new line." is displayed in sync with her speech.',
      'Text reading "This is a new line.", synchronized with her speech, appears at the bottom.',
      'Text reading "New line" is a translation of her speech.',
      'Text reading "New line" transcribes the spoken words.',
      'Text reading "La la" is highlighted word by word as she sings.',
    ])('rejects displayed speech and contradictory directions: %s', (direction) => {
      expect(() => assertH3Prompt({
        inputMode: 'reference', prompt: withDirection(direction),
        references: { pictureCount: 1, audioCount: 1 },
      })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:SUBTITLE_VISIBLE_TEXT_FORBIDDEN')
    })

    it.each([
      'A sign reading "No captions. Add subtitles." hangs above the door.',
      'Text reading "Chapter One" appears at the bottom of the frame.',
      'A sign reading "OPEN" glows. Her speech is synchronized with her lips.',
      'A sign reading "OPEN" glows in sync with her speech.',
      'A sign reading "OPEN" is illuminated in sync with her speech.',
      'A label reading "EXIT" is a translation of the French sign.',
      'A sign reading "<d>No captions.</d>" hangs above the door.',
    ])('preserves source-required non-subtitle text: %s', (direction) => {
      expect(() => assertH3Prompt({
        inputMode: 'reference', prompt: withDirection(direction),
        references: { pictureCount: 1, audioCount: 1 },
      })).not.toThrow()
    })
  })

  it('rejects an explicitly requested subtitle carrier outside dialogue', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] Subtitles reading "Welcome" appear as she turns toward the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:SUBTITLE_VISIBLE_TEXT_FORBIDDEN')
  })

  it('rejects an explicit subtitle instruction outside detailed_description', () => {
    const prompt = referencePrompt.replace(
      '[reference generation] She turns toward the doorway while preserving <Subject 1> from <Picture 1>.',
      '[reference generation] She turns toward the doorway. Add burned-in subtitles at the bottom.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:SUBTITLE_VISIBLE_TEXT_FORBIDDEN')
  })

  it('keeps policy wording inside dialogue opaque to outside-dialogue validation', () => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      '<d>[English]Do not add subtitles or captions under any circumstances.</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

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

  it('requires the official reference-generation summary prefix', () => {
    const prompt = referencePrompt.replace('[reference generation] ', '')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_SUMMARY_PREFIX_REQUIRED')
  })

  it.each([
    {
      name: 'omits the audio-reference task type when frozen audio is present',
      prompt: referenceAudioPrompt.replace(
        '[reference generation + audio reference]',
        '[reference generation]',
      ),
      references: { pictureCount: 1, audioCount: 1 },
    },
    {
      name: 'claims audio-reference conditioning without frozen audio',
      prompt: referencePrompt.replace(
        '[reference generation]',
        '[reference generation + audio reference]',
      ),
      references: { pictureCount: 1, audioCount: 0 },
    },
    {
      name: 'adds an unsupported task type',
      prompt: referencePrompt.replace(
        '[reference generation]',
        '[foo + reference generation]',
      ),
      references: { pictureCount: 1, audioCount: 0 },
    },
  ])('rejects a Ref summary that $name', ({ prompt, references }) => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_SUMMARY_PREFIX_REQUIRED')
  })

  it('requires the official style opening before the first reference shot', () => {
    const prompt = referencePrompt.replace(`${REFERENCE_STYLE_OPENING}\n`, '')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_STYLE_OPENING_REQUIRED')
  })

  it.each([
    '.',
    '<Picture 1>',
    '这是一段 cinematic 风格.',
    'A cinematic style.\nNatural lighting.\nRestrained contrast.',
    'A cinematic style. Natural lighting. Restrained contrast.',
  ])('rejects an invalid reference style opening %s', (opening) => {
    const prompt = referencePrompt.replace(REFERENCE_STYLE_OPENING, opening)
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_STYLE_OPENING_INVALID')
  })

  it.each([
    'The target video uses a realistic cinematic style.\nNatural indoor lighting gives it restrained contrast.',
    'The target video preserves the realistic cinematic style of <Picture 1>.',
    'The target video uses a cinematic style inspired by Agnès Varda.',
    'A style inspired by Dr. Seuss and Mr. Bean shapes the scene.\nNatural light softens the frame.',
    'The target uses a style inspired by Capt. Smith.\nNatural lighting softens the frame.',
    'The documentary look evokes street photography from the U.S.',
    'The visual style evokes U.S. Navy documentary footage.',
    'The image uses tones inspired by Pop Art. The lighting is warm.',
  ])('allows one or two English style sentences regardless of line wrapping: %s', (opening) => {
    const prompt = referencePrompt.replace(
      REFERENCE_STYLE_OPENING,
      opening,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it('counts a sentence-ending dotted abbreviation toward the style limit', () => {
    const prompt = referencePrompt.replace(
      REFERENCE_STYLE_OPENING,
      'The palette recalls the U.S. The lighting is soft. The shot is static.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_STYLE_OPENING_INVALID')
  })

  it.each([
    ['subject_definitions', '<Subject 1> is the woman in <Picture 1>.', '<Subject 1> 是 <Picture 1> 中的女人。'],
    ['summary', '[reference generation] She turns toward the doorway while preserving <Subject 1> from <Picture 1>.', '[reference generation] 她转向门口并保留 <Picture 1> 中的 <Subject 1>。'],
    ['retention_analysis', 'Her identity, clothing, and the room layout from <Picture 1> are retained.', '保留 <Picture 1> 中的人物身份、服装和房间布局。'],
    ['detailed_description', '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.', '[Shot 1] 她转向门口。'],
    ['overall_soundscape', 'Soft room tone, fabric movement, and her quiet breath.', '轻柔的室内底噪、布料摩擦和呼吸声。'],
  ])('requires English Ref prose in %s', (_section, source, replacement) => {
    const prompt = referencePrompt.replace(source, replacement)
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_NON_ENGLISH_TEXT_INVALID')
  })

  it('allows non-Latin Ref text only inside official dialogue and visible-text literals', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] A sign with visible text reading "出口" hangs by the door while <Subject 1> says <d>[Chinese]请从这里出去。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it('rejects Latin-script prose that is not English', () => {
    const prompt = `subject_definitions:
<Subject 1> est la femme montrée dans <Picture 1>.

summary:
[reference generation] Elle se tourne vers la porte en conservant <Subject 1> de <Picture 1>.


retention_analysis:
<Subject 1> (dans [Shot 1]): fully_preserved - Son identité, ses vêtements et la pièce de <Picture 1> sont conservés.

detailed_description:
Le clip utilise un style cinématographique réaliste avec une lumière naturelle.
[Shot 1] Elle remarque la porte, se tourne et reste face à elle.

overall_soundscape:
Une ambiance intérieure douce, le mouvement du tissu et sa respiration calme.

non_diegetic_music:
N/A`
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_NON_ENGLISH_TEXT_INVALID')
  })

  it('rejects Dutch prose even though it shares English function words', () => {
    const prompt = `subject_definitions:
<Subject 1> is de vrouw in <Picture 1>.

summary:
[reference generation] Zij draait naar de deur en behoudt <Subject 1> uit <Picture 1>.


retention_analysis:
<Subject 1> (in [Shot 1]): fully_preserved - Haar identiteit, kleding en kamer uit <Picture 1> blijven behouden.

detailed_description:
De video was gefilmd in een realistische stijl met natuurlijk licht.
[Shot 1] De vrouw ziet de deur, draait zich om en blijft staan.

overall_soundscape:
Een zachte kamertoon met stofbeweging en rustige ademhaling.

non_diegetic_music:
N/A`
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_NON_ENGLISH_TEXT_INVALID')
  })

  it('rejects Polish prose without extending a handwritten language list', () => {
    const prompt = `subject_definitions:
<Subject 1> to kobieta pokazana na <Picture 1>.

summary:
[reference generation] Kobieta obraca się w stronę drzwi i zachowuje wygląd z <Picture 1>.


retention_analysis:
<Subject 1> (w [Shot 1]): fully_preserved - Tożsamość, ubranie i pokój z <Picture 1> pozostają zachowane.

detailed_description:
Film wykorzystuje realistyczny styl kinowy i naturalne oświetlenie.
[Shot 1] Kobieta zauważa drzwi, obraca się i zatrzymuje.

overall_soundscape:
Cichy ton pokoju, ruch tkaniny i spokojny oddech.

non_diegetic_music:
N/A`
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_NON_ENGLISH_TEXT_INVALID')
  })

  it('does not reject concise valid English prose for lacking function words', () => {
    const prompt = `subject_definitions:
<Subject 1>: woman from <Picture 1>.

summary:
[reference generation] Woman turns.


retention_analysis:
<Subject 1>: fully_preserved - Identity retained.

detailed_description:
Realistic cinematic portrait style.
[Shot 1] <Subject 1> turns, settles.

overall_soundscape:
Room tone.

non_diegetic_music:
N/A`
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it('does not reject valid English prose built from international art terms', () => {
    const prompt = `subject_definitions:
<Subject 1>: femme fatale from <Picture 1>.

summary:
[reference generation] Femme fatale waits.


retention_analysis:
<Subject 1>: fully_preserved - Identity retained.

detailed_description:
Noir chiaroscuro.
[Shot 1] <Subject 1>, the femme fatale, waits.

overall_soundscape:
Jazz club ambience.

non_diegetic_music:
N/A`
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it('does not let a repeated non-English proper name override clear English syntax', () => {
    const prompt = `subject_definitions:
<Subject 1> is Agnieszka, an artist from Łódź shown in <Picture 1>.

summary:
[reference generation] Agnieszka walks through Łódź while preserving her identity from <Picture 1>.


retention_analysis:
<Subject 1>: fully_preserved - Her identity and clothing from <Picture 1> remain unchanged.

detailed_description:
The clip uses a Łódź Film School documentary style.
[Shot 1] <Subject 1>, Agnieszka, walks through Łódź and pauses beside a doorway.

overall_soundscape:
Łódź street ambience with footsteps and quiet traffic.

non_diegetic_music:
N/A`
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it('rejects a Video token because the current H3 Ref capability freezes no reference video', () => {
    const prompt = referencePrompt.replace(
      '<Subject 1> is the woman in <Picture 1>.',
      '<Subject 1> is the woman in <Picture 1>, moving like the person in <Video 1>.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:VIDEO_REFERENCE_UNSUPPORTED:1')
  })

  it('rejects a Subject token that has no independent definition', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] <Subject 2> notices the doorway, turns, and settles facing it.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_SUBJECT_UNDEFINED:2')
  })

  it.each([
    '<Subject 1> says <d>[English]Type <Subject 2> now.</d>',
    'A sign reading "<Subject 2>" hangs beside <Subject 1>.',
  ])('does not parse a verbatim Subject token as protocol: %s', (description) => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      `[Shot 1] ${description}`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it('rejects legacy reference relationship prose in retention analysis', () => {
    const prompt = referencePrompt.replace(
      '<Subject 1> (appears in [Shot 1]): fully_preserved - Her identity, clothing, and the room layout from <Picture 1> are retained.',
      '<Picture 1>: reference - preserve <Subject 1>.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_RETENTION_RELATION_INVALID:Picture:1')
  })

  it('rejects speaker IDs from official reference retention analysis', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
      '<Audio 1>: reference - <Subject 1> (S1) follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_RETENTION_SPEAKER_FORBIDDEN')
  })

  it('allows explicitly requested non-subtitle visible text in the detailed description', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] A sign reading "欢迎" appears as <Subject 1> says <d>[English]No subtitles, please.</d> and turns toward the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it.each([
    'A shirt bears visible text reading "Welcome" as she turns.',
    'Text reading "Welcome" appears at the bottom of the frame.',
    'Neon text reading "OPEN" glows above the doorway.',
    'Bright orange text reading "你好" glows beside the doorway.',
    'A golden sign reading "Bienvenue" hangs above the doorway.',
    'A sign reading "Welcome aboard." audibly creaks as she turns.',
    'A sign reading "He said \\"Hello\\"." hangs above the doorway.',
  ])('allows official quoted visible text through an official or explicit carrier: %s', (description) => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      `[Shot 1] <Subject 1> stands in the doorway. ${description}`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it('allows an official visible-text carrier at the start of a later sentence', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] The camera holds steady on <Subject 1>. A sign reading "Welcome" hangs above the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it.each([
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[English]Hey!</d> A sign reading "OPEN" glows.',
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[English]He said "Stop."</d> A sign reading "OPEN" glows.',
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[English]Stop!<scenetrans></d> The same voice continues seamlessly across the cut. A sign reading "OPEN" glows.\n[Shot 2] At 00:02.000, the camera cuts to a close-up. <Subject 1> (S1) says <d>[English]<scenetrans>Now.</d>',
  ])('preserves the dialogue-final sentence boundary before visible text: %s', (description) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      description,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each([
    '<d>[English]Hello</d>',
    '<d>Hello.</d>',
    '<d>[English]Hello</d>.',
  ])('rejects a Ref dialogue block that omits official language or in-block punctuation: %s', (dialogue) => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      dialogue,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_CONTENT_INVALID')
  })

  it('rejects quoted dialogue outside d even when the same dialogue is tagged later', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says "这是新台词。" and repeats <d>[Chinese]这是新台词。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_QUOTED_TEXT_CONTEXT_INVALID')
  })

  it('rejects quoted Ref dialogue when no d block exists', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] She faces camera and says "这是新台词。"',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_QUOTED_TEXT_CONTEXT_INVALID')
  })

  it.each([
    'She faces camera and says "这是新台词。',
    'She faces camera and says "这是\n新台词。"',
    'She faces camera and says “这是新台词。”',
    'A sign is beside her as she starts reading "这是新台词。" aloud.',
    'A sign is beside her as she starts reading "这是新台词。" out loud.',
    'She is audibly reading "这是新台词。".',
    'She is reading "这是新台词。" loudly.',
    'A woman reading "Welcome" smiles at the camera.',
    'The woman reading "Welcome" to her child smiles.',
    'She is at the screen reading "Hello" to her child.',
    'She stands at the sign reading "Hello" to her child.',
    'A woman at the sign reading "Hello" to her child smiles.',
    'The woman at the sign reading "Hello" loudly smiles.',
    'She holds a golden sign reading "Welcome".',
    'She reads a sign reading "Welcome".',
  ])('rejects non-canonical quoted text outside d: %s', (description) => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      `[Shot 1] ${description}`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_QUOTED_TEXT_CONTEXT_INVALID')
  })

  it('rejects exact dialogue repeated outside its detailed-description dialogue tag', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
      '<Subject 1> says 这是新台词。 using <Audio 1> as a voice-timbre reference.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_OUTSIDE_TAG')
  })

  it('ignores a valid scenetrans pair when checking dialogue placement', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '<Subject 1> says "这是。" using <Audio 1> as a voice-timbre reference.',
      )
      .replace(
        '<d>[Chinese]这是新台词。</d>',
        '<d>[Chinese]这是。<scenetrans></d> The same voice continues seamlessly across the cut.\n[Shot 2] At 00:02.000, the camera cuts to a close-up. <Subject 1> (S1) says <d>[Chinese]<scenetrans>新台词。</d>',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_OUTSIDE_TAG')
  })

  it('allows an official paired dialogue transition across a shot cut', () => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      '<d>[Chinese]这是<scenetrans></d> The same voice continues seamlessly across the cut. [Shot 2] At 00:02.000, the camera cuts to a close-up. <Subject 1> (S1) says <d>[Chinese]<scenetrans>新台词。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each([
    '<d>[Chinese]这是新台词。<scenetrans></d>',
    '<d>[Chinese]这是<scenetrans></d> The same voice continues seamlessly across the cut. Then <Subject 1> (S1) says <d>[Chinese]<scenetrans>新台词。</d>',
    '<d>[Chinese]这是<scenetrans></d>\n[Shot 2] At 00:02.000, the camera cuts to a close-up. <Subject 1> (S1) says <d>[Chinese]<scenetrans>新台词。</d>',
    '<d>[Chinese]这是<scenetrans></d> The camera movement continues seamlessly across the cut. [Shot 2] At 00:02.000, the camera cuts to a close-up. <Subject 1> (S1) says <d>[Chinese]<scenetrans>新台词。</d>',
    '<d>[Chinese]这是<scenetrans></d> The room tone continues seamlessly across the cut. [Shot 2] At 00:02.000, the camera cuts to a close-up. <Subject 1> (S1) says <d>[Chinese]<scenetrans>新台词。</d>',
    '<d>[Chinese]这是<scenetrans></d> A sign with visible text reading "The same voice continues seamlessly across the cut" hangs beside the door. [Shot 2] At 00:02.000, the camera cuts to a close-up. <Subject 1> (S1) says <d>[Chinese]<scenetrans>新台词。</d>',
  ])('rejects an incomplete official scenetrans protocol: %s', (dialogueSequence) => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      dialogueSequence,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_SCENETRANS_INVALID')
  })

  it('rejects quoted dialogue repeated in a non-detailed section', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
      '<Subject 1> says "这是新台词。" using <Audio 1> as a voice-timbre reference.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_OUTSIDE_TAG')
  })

  it('rejects a quoted single-character dialogue repeated in a non-detailed section', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '<Subject 1> says "好。" using <Audio 1> as a voice-timbre reference.',
      )
      .replace('这是新台词。', '好。')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_OUTSIDE_TAG')
  })

  it.each(['A.', 'audio.'])('does not mistake Ref protocol metadata for short dialogue %s', (dialogue) => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      `<d>[English]${dialogue}</d>`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('does not mistake a Ref shot number for numeric dialogue', () => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      '<d>[English]1.</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows the official cutoff tag inside reference dialogue', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] <Subject 1> turns toward the doorway and says <d>[Chinese]我终于找到<cutoff></d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it.each([
    {
      name: 'an unclosed opening tag',
      value: '<d>[Chinese]我终于找到了。',
    },
    {
      name: 'an orphan closing tag',
      value: '[Chinese]我终于找到了。</d>',
    },
    {
      name: 'nested dialogue tags',
      value: '<d>[Chinese]我终于<d>找到了。</d></d>',
    },
  ])('rejects $name in a Ref detailed description', ({ value }) => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      `[Shot 1] She turns toward the doorway and says ${value}`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_TAG_INVALID')
  })

  it.each([
    '<d>[Chinese]我终于<cutoff>找到了。</d>',
    '<d>[Chinese]我终于找到<cutoff><cutoff></d>',
  ])('rejects malformed Ref cutoff placement %s', (dialogue) => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      `[Shot 1] She turns toward the doorway and says ${dialogue}`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_CUTOFF_INVALID')
  })

  it('rejects more than one cutoff across separate Ref dialogue blocks', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] She says <d>[Chinese]第一句<cutoff></d>. Then she says <d>[Chinese]第二句<cutoff></d>.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_CUTOFF_INVALID')
  })

  it('requires cutoff to be in the final Ref dialogue block at the video end', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] She says <d>[Chinese]第一句<cutoff></d>. Then she says <d>[Chinese]第二句。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_CUTOFF_INVALID')
  })

  it('rejects post-cutoff action after the final Ref dialogue', () => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] She says <d>[Chinese]第一句<cutoff></d>. She then turns away.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_CUTOFF_INVALID')
  })

  it.each([
    {
      name: 'outside detailed_description',
      prompt: referencePrompt.replace(
        '[reference generation] She turns toward the doorway while preserving <Subject 1> from <Picture 1>.',
        '[reference generation] She turns toward the doorway<cutoff> while preserving <Subject 1> from <Picture 1>.',
      ),
    },
    {
      name: 'outside a dialogue block',
      prompt: referencePrompt.replace(
        '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
        '[Shot 1] <Subject 1> notices the doorway<cutoff>, turns, and settles facing it.',
      ),
    },
  ])('rejects a reference cutoff tag $name', ({ prompt }) => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:DIALOGUE_CUTOFF_SECTION_INVALID')
  })

  it('rejects media reference indexes above the frozen manifest', () => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: referenceAudioPrompt.replaceAll('<Audio 1>', '<Audio 2>'),
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:MEDIA_REFERENCE_INDEX_OUT_OF_RANGE:Audio:2')
  })

  it('rejects a frozen audio omitted from the prompt', () => {
    const prompt = referencePrompt.replace(
      '[reference generation]',
      '[reference generation + audio reference]',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_MISSING:1')
  })

  it('rejects one audio bound to two speaker identities', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      '<Subject 2> (S2) is the second person shown in <Picture 1>.\n<Audio 1> is the voice-timbre reference for <Subject 1> (S1) and <Subject 2> (S2).',
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

  it('rejects two different audio definitions merged onto one line', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> and <Audio 2> are voice-timbre references for <Subject 1> (S1).',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre.\n<Audio 2>: reference - The target speaker follows <Audio 2>\'s vocal timbre.',
      )
      .replace('from <Audio 1>', 'from <Audio 1> and <Audio 2>')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_BINDING_INVALID:1')
  })

  it('rejects a second speaker binding for an Audio on another definition line', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).\n<Subject 2> (S2) is the second person shown in <Picture 1> and also uses <Audio 1>.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_BINDING_INVALID:1')
  })

  it('rejects an extra standalone Speaker marker in an Audio definition', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1) and also for the chorus (S2).',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_BINDING_INVALID:1')
  })

  it('requires each audio reference in retention and keeps dialogue owned by its bound speaker', () => {
    const withoutRetention = referenceAudioPrompt.replace(
      '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.\n',
      '',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: withoutRetention,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_RETENTION_MISSING:1')

    const withoutDialogueSpeaker = referenceAudioPrompt.replace(
      '[Shot 1] <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '[Shot 1] The person faces camera and says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: withoutDialogueSpeaker,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_SPEAKER_DIALOGUE_MISSING:1')
  })

  it('accepts the official self-reference inside an audio retention entry', () => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: referenceAudioPrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows a reference-audio speaker identified by a stable voice description', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is the voice-timbre reference for the calm off-screen narrator (S1).',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
        '<Subject 1> stands in silence. The calm off-screen narrator (S1), using the voice timbre referenced from <Audio 1>, says in an off-screen voiceover:',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows a synchronized reused vocal cue without inventing a speaker binding', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a directly reused synchronized vocal cue.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reuse] <Subject 1> gestures when <Audio 1> reaches its vocal cue.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: partially_copy - <Audio 1> contributes one synchronized vocal cue.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        'When <Audio 1> reaches the phrase <d>[Chinese]这是新台词。</d>, <Subject 1> performs the corresponding hand gesture.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('requires an unbound Audio reference to be applied in an audible output section', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the wind ambience.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the target uses the wind ambience referenced by <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target follows the wind texture from <Audio 1> without copying the original signal.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone without wind.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    'Do not use <Audio 1>. Keep quiet room tone.',
    'Quiet room tone without <Audio 1>.',
    'No part of <Audio 1> is directly reused.',
    'No part of <Audio 1> is directly reused as the soundtrack.',
    'None of <Audio 1> is audible.',
    '<Audio 1> is directly reused nowhere in the audible scene.',
    'The room remains quiet without <Audio 1>, which otherwise plays as the soundtrack.',
    'Wind ambience from <Audio 1> is not audible.',
    'Wind ambience from <Audio 1> is never used.',
    'Wind ambience from <Audio 1> is audible nowhere.',
    'Wind ambience from <Audio 1> plays nowhere in the video.',
    'Wind ambience from <Audio 1> is used only as a visual waveform on a silent screen.',
    '<Audio 1> plays as a silent soundtrack.',
    '<Audio 1> sounds inaudible.',
    'None of the content from <Audio 1> plays as the soundtrack.',
    'None of the source audio from <Audio 1> is heard.',
    'None of the soundtrack from <Audio 1> plays.',
    '<Audio 1> plays as a visual waveform soundtrack.',
    '<Audio 1> plays as the soundtrack, but the soundtrack is silent.',
    '<Audio 1> plays as the soundtrack, none of it is audible.',
    '<Audio 1> plays as the soundtrack, but it is silent.',
    '<Audio 1> plays as the soundtrack, but it is muted.',
    '<Audio 1> plays as the soundtrack.',
    '<Audio 1> plays audibly, but none of it can be heard.',
    '<Audio 1> plays audibly, but its output is silent.',
    '<Audio 1> plays audibly, although it is muted.',
  ])('does not count a negated unbound Audio citation as an application: %s', (soundscape) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the wind ambience.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the target references the wind ambience from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target follows the wind texture from <Audio 1> without copying the original signal.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', soundscape)
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    '<Audio 1> plays as the soundtrack, but is never heard.',
    '<Audio 1> plays as the soundtrack without interruption or any audible sound.',
    'No sound from <Audio 1> plays as the soundtrack.',
    '<Audio 1> plays as the soundtrack and is inaudible.',
    '<Audio 1> plays as the soundtrack and is no longer audible.',
    '<Audio 1> plays as the soundtrack and cannot be heard.',
  ])('rejects an unbound Audio application contradicted by an audibility denial: %s', (soundscape) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the wind ambience.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the target references the wind ambience from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target follows the wind texture from <Audio 1> without copying the original signal.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', soundscape)
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('does not count a visual waveform mention as an unbound Audio application', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the wind ambience.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the target references the wind ambience from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target follows the wind texture from <Audio 1> without copying the original signal.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        'A silent waveform of <Audio 1> is shown while <Subject 1> faces camera.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    'A visual waveform uses <Audio 1> as its shape reference.',
    '<Audio 1> provides a visual waveform on the screen.',
    'A visual sound waveform uses <Audio 1> as its shape reference.',
    '<Audio 1> provides a visual sound waveform on the screen.',
    '<Audio 1> plays as a visual waveform on a silent screen.',
    '<Audio 1> begins as a waveform on a silent screen.',
    'The waveform of <Audio 1> plays in a silent video editor.',
    'Wind ambience from <Audio 1> fills a visual waveform display on a silent screen.',
    'The visual waveform of sound from <Audio 1> fills the scene.',
    '<Audio 1> begins as a soundtrack waveform on a silent screen.',
    '<Audio 1> is reused as a soundtrack waveform on a silent screen.',
    'Wind ambience from <Audio 1> is played as a visual waveform on a silent monitor.',
    '<Audio 1> is played as a visual waveform on a silent monitor.',
  ])('does not count a visual-only Audio citation as audible application: %s', (description) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the wind ambience.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the target references the wind ambience from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target follows the wind texture from <Audio 1> without copying the original signal.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        description,
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    'Without copying the source signal, wind ambience from <Audio 1> fills the room.',
    'The room has no music, while wind ambience from <Audio 1> fills the room.',
    'Wind ambience from <Audio 1> fills the room without interruption.',
    'Wind ambience from <Audio 1> fills the room without distortion and with clean audio output.',
    'Wind ambience from <Audio 1> fills the room without any added sound.',
  ])('allows a positive unbound Audio application despite unrelated negation: %s', (soundscape) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the wind ambience.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the target references the wind ambience from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target follows the wind texture from <Audio 1> without copying the original signal.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', soundscape)
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows referenced music played by a target-only visible device', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Subject 2> is a target-visible in-scene playback entity: a radio newly added to the target scene.\n<Audio 1> is a reference for the radio music.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> stands beside a newly added radio that plays the music from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the melody and radio-speaker texture from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        'The visible in-scene <Subject 2> plays <Audio 1> audibly through its physical output while <Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone around the newly added radio.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each([
    {
      definition: '<Subject 2> is a target-visible in-scene playback entity from <Picture 1>: a radio.',
      error: 'REFERENCE_PLAYBACK_SUBJECT_DEFINITION_INVALID:2',
    },
    {
      definition: '<Subject 2> is a source-backed in-scene playback entity that imitates <Subject 1> from <Picture 1>: an orchestral layer.',
      error: 'REFERENCE_PLAYBACK_SUBJECT_DEFINITION_INVALID:2',
    },
    {
      definition: '<Subject 2> is a target-visible in-scene playback entity: an audience-only soundtrack layer.',
      error: 'REFERENCE_PLAYBACK_SUBJECT_AUDIENCE_CONFLICT:2',
    },
  ])('rejects a contradictory playback definition: $definition', ({ definition, error }) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        `${definition}\n<Audio 1> is a reference for the requested music.`,
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears beside <Subject 2> while it plays <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the requested sound from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        'The visible in-scene <Subject 2> plays <Audio 1> audibly through its physical output while <Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow(`VIDEO_PROMPT_PROFILE_INVALID:${error}`)
  })

  it('rejects a playback Subject that borrows another Subject picture binding on the same line', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Subject 2> is an audience soundtrack; <Subject 1> is shown in <Picture 1>.\n<Audio 1> is a reference for the soundtrack.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while <Subject 2> supplies the requested music from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the soundtrack from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        'The visible in-scene <Subject 2> plays <Audio 1> audibly through its physical output while <Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_SUBJECT_DEFINITION_INVALID:2')
  })

  it('allows referenced music played by an audible in-scene device', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Subject 2> is a source-backed in-scene playback entity from <Picture 1>: the radio.\n<Audio 1> is a reference for the radio music.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> stands beside a radio that plays the music from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Subject 2> (appears in [Shot 1]): fully_preserved - The radio from <Picture 1> is retained.\n<Audio 1>: reference - Preserve the melody and radio-speaker texture from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        'The visible in-scene <Subject 2> plays <Audio 1> audibly through its physical output while <Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone around the radio.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each([
    ['laptop', 'speaker'],
    ['jukebox', 'speaker'],
    ['gramophone', 'horn'],
    ['intercom', 'grille'],
    ['turntable', 'connected amplifier'],
    ['music box', 'resonating chamber'],
  ])(
    'allows referenced music played by an arbitrary visible in-scene %s through its %s',
    (device, output) => {
      const prompt = referenceAudioPrompt
        .replace(
          '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
          `<Subject 2> is a source-backed in-scene playback entity from <Picture 1>: the ${device}.\n<Audio 1> is a reference for the ${device} music.`,
        )
        .replace(
          '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
          `[reference generation + audio reference] <Subject 1> stands beside a ${device} that plays the music from <Audio 1>.`,
        )
        .replace(
          '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
          `<Subject 2> (appears in [Shot 1]): fully_preserved - The ${device} and its ${output} from <Picture 1> are retained.\n<Audio 1>: reference - Preserve the melody and ${device}-speaker texture from <Audio 1>.`,
        )
        .replace(
          '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
          'The visible in-scene <Subject 2> plays <Audio 1> audibly through its physical output while <Subject 1> faces camera in silence.',
        )
        .replace('Clean speech with quiet room tone.', `Quiet room tone around the ${device}.`)
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt,
        references: { pictureCount: 1, audioCount: 1 },
      })).not.toThrow()
    },
  )

  it.each([
    'The soundtrack plays',
    'The audience score plays',
    'The background music plays',
  ])('does not mistake an audience-music noun phrase for an in-scene source: %s', (source) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the music track.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the requested music is referenced from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the musical character from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        `${source} <Audio 1> audibly while <Subject 1> faces camera in silence.`,
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    'An orchestral layer plays',
    'The cinematic theme plays',
  ])('requires a physical output relation instead of guessing an in-scene source: %s', (source) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the music track.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the requested music is referenced from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the musical character from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        `${source} <Audio 1> audibly while <Subject 1> faces camera in silence.`,
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    ['An orchestral layer plays', 'through the mix'],
    ['The cinematic theme plays', 'from nowhere'],
    ['The emotional cue plays', 'through the scene'],
    ['The visible in-scene orchestral layer plays', 'through its physical mix'],
    ['The visible in-scene cinematic theme plays', 'through its physical soundtrack'],
    ['The visible in-scene soundtrack plays', 'through its physical speakers'],
    ['The visible in-scene audience score plays', 'through its physical speakers'],
    ['The visible in-scene orchestral layer plays', 'through its physical speakers for the audience'],
    ['The visible in-scene cinematic theme plays', 'through its physical speakers for the viewer'],
  ])('rejects an unowned or audience-side output relation: %s %s', (source, output) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the music track.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while the requested music is referenced from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the musical character from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        `${source} <Audio 1> audibly ${output} while <Subject 1> faces camera in silence.`,
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('allows a physical device located in the visual background', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Subject 2> is a source-backed in-scene playback entity from <Picture 1>: the radio in the background.\n<Audio 1> is a reference for the radio music.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> stands before a radio that plays the music from <Audio 1>.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Subject 2> (appears in [Shot 1]): fully_preserved - The background radio from <Picture 1> is retained.\n<Audio 1>: reference - Preserve the melody and radio-speaker texture from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        'The visible in-scene <Subject 2> plays <Audio 1> audibly through its physical output while <Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', 'Quiet room tone around the radio.')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each(['all viewers', 'every listener'])(
    'rejects otherwise valid in-scene playback assigned to %s',
    (audience) => {
      const prompt = referenceAudioPrompt
        .replace(
          '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
          '<Subject 2> is a source-backed in-scene playback entity from <Picture 1>: the radio.\n<Audio 1> is a reference for the radio music.',
        )
        .replace(
          '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
          '[reference generation + audio reference] <Subject 1> stands beside a radio that plays the music from <Audio 1>.',
        )
        .replace(
          '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
          '<Subject 2> (appears in [Shot 1]): fully_preserved - The radio from <Picture 1> is retained.\n<Audio 1>: reference - Preserve the melody and radio-speaker texture from <Audio 1>.',
        )
        .replace(
          '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
          `The visible in-scene <Subject 2> plays <Audio 1> audibly through its physical output for ${audience} while <Subject 1> faces camera in silence.`,
        )
        .replace('Clean speech with quiet room tone.', 'Quiet room tone around the radio.')
      expect(() => assertH3Prompt({
        inputMode: 'reference',
        prompt,
        references: { pictureCount: 1, audioCount: 1 },
      })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
    },
  )

  it('rejects audience-only referenced music even when it uses a generic audible cue', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the music track.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while <Audio 1> supplies the requested music.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the musical character from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> faces camera in silence.',
      )
      .replace(
        'Clean speech with quiet room tone.',
        'The audience-only score from <Audio 1> plays audibly.',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('rejects audience-only referenced music declared after a generic audible cue', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the music track.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while <Audio 1> supplies the requested music.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the musical character from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> faces camera in silence.',
      )
      .replace(
        'Clean speech with quiet room tone.',
        '<Audio 1> plays audibly as the audience-only score.',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    'The cinematic audience-only soundtrack plays <Audio 1> audibly.',
    'A dramatic background score plays <Audio 1> audibly.',
    '<Audio 1> plays audibly. It forms the background score for the audience.',
  ])('rejects audience scoring across the complete soundscape: %s', (soundscape) => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is a reference for the music track.',
      )
      .replace(
        '[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.',
        '[reference generation + audio reference] <Subject 1> appears while <Audio 1> supplies the requested music.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - Preserve the musical character from <Audio 1>.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> faces camera in silence.',
      )
      .replace('Clean speech with quiet room tone.', soundscape)
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('allows dialogue from an unbound narrator when another speaker uses reference audio', () => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      '<d>[Chinese]这是新台词。</d> A calm off-screen narrator (S2) says in an off-screen voiceover: <d>[English] The day begins.</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows a compound speaker event when its reference-audio participant is cited', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> and another speaker (S1,S2), with S1 using the voice timbre referenced from <Audio 1>, shout together,',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()

    const naturalAssociationPrompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> and another speaker (S1,S2), with S1 drawing vocal timbre from <Audio 1>, shout together,',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: naturalAssociationPrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()

    const negatedAssociationPrompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> and another speaker (S1,S2), with S1 not using <Audio 1>, shout together,',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: negatedAssociationPrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')

    const contractedNegationPrompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> and another speaker (S1,S2), with S1 doesn\'t use <Audio 1>, shout together,',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: contractedNegationPrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')

    const postCueNegationPrompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> and another speaker (S1,S2), with S1 using no timbre from <Audio 1>, shout together,',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: postCueNegationPrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    '<Subject 1> and another speaker (S1,S2), with S1 watching a radio, which plays music and uses <Audio 1>, shout together,',
    '<Subject 1> and another speaker (S1,S2), with S1 watching a machine, whose voice comes from <Audio 1>, shout together,',
    '<Subject 1> and another speaker (S1,S2), with S1 watching a radio that softly crackles and uses <Audio 1>, shout together,',
    '<Audio 1> is visual input for a machine that guides S1, and the pair (S1,S2) says',
  ])('does not borrow a compound-Speaker Audio cue from an unrelated object: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    '<Subject 1> (S1), not using <Audio 1>, says',
    '<Subject 1> (S1), doesn\'t use <Audio 1> and says',
    '<Subject 1> (S1), using no timbre from <Audio 1>, says',
    '<Subject 1> (S1), using neither <Audio 1> nor another source, says',
    '<Subject 1> (S1), rather than using <Audio 1>, says',
    '<Subject 1> (S1), beside <Audio 1>, says',
    '<Subject 1> (S1) uses <Audio 1> only as background music, then says',
    '<Subject 1> (S1) uses <Audio 1> as a phone ringtone, then says',
    '<Subject 1> (S1) references <Audio 1> for the score, not for her voice, then says',
    '<Subject 1> (S1), using <Audio 1> as an alarm to time the lighting, says',
  ])('rejects a single speaker Audio token without a positive application: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('rejects a negated leading Audio-to-speaker relationship', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Audio 1> is not the voice timbre reference for <Subject 1> (S1), who says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    '<Audio 1> is visual input for a radio, which guides <Subject 1> (S1), who says',
    '<Audio 1> is visual input for a machine that guides <Subject 1> (S1), who says',
    '<Audio 1> is visual input for a machine, whose voice guides <Subject 1> (S1), who says',
  ])('does not borrow a reverse Audio-to-speaker cue from an unrelated object: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    'A loudspeaker, using <Audio 1> for its calibration tone, sits beside <Subject 1> (S1), who says',
    '<Subject 1> (S1), whose radio is using <Audio 1>, says',
    '<Subject 1> (S1) watches a radio, whose voice comes from <Audio 1>, then says',
    '<Subject 1> (S1) watches a radio that plays music and uses <Audio 1>, then says',
    '<Subject 1> (S1) watches a radio that softly crackles and uses <Audio 1>, then says',
  ])('does not borrow an Audio cue owned by an unrelated object: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    '<Subject 1> (S1), whose voice timbre is taken from <Audio 1>, says',
    '<Subject 1> (S1), who uses <Audio 1>, faces camera and says',
    '<Subject 1> (S1), who is using the warm voice from <Audio 1>, says',
    '<Subject 1> (S1), whose warm voice comes from <Audio 1>, says',
    '<Subject 1> (S1) speaks in the voice of <Audio 1> and says',
  ])('allows an unambiguous natural Audio relationship: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('rejects a negated final Audio bridge after an earlier positive mapping', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1), using <Audio 1>, faces camera. Then, not using that timbre, says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('does not treat an unrelated without modifier as Audio-association negation', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1), without looking away and using <Audio 1>, says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()

    const whilePrompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1), without looking away while using <Audio 1>, says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: whilePrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows a bound participant to use its Audio only in the vocal event where it applies', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Subject 1> (S1) is the person shown in <Picture 1>.',
        '<Subject 1> (S1) is the first person shown in <Picture 1>.\n<Subject 2> (S2) is the second person shown in <Picture 1>.',
      )
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).\n<Audio 2> is the voice-timbre reference for <Subject 2> (S2).',
      )
      .replace(
        '<Subject 1> (appears in [Shot 1]): fully_preserved - The person\'s identity and appearance from <Picture 1> are retained.',
        '<Subject 1> (appears in [Shot 1]): fully_preserved - The first person\'s identity and appearance from <Picture 1> are retained.\n<Subject 2> (appears in [Shot 1]): fully_preserved - The second person\'s identity and appearance from <Picture 1> are retained.',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The first speaker follows <Audio 1>\'s vocal timbre.\n<Audio 2>: reference - The second speaker follows <Audio 2>\'s vocal timbre.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> and <Subject 2> (S1,S2), with S1 using <Audio 1>, say together <d>[Chinese]这是第一句。</d> Then <Subject 2> (S2), using <Audio 2>, says <d>[Chinese]这是第二句。</d>',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).not.toThrow()

    const mappedPrompt = prompt.replace(
      'with S1 using <Audio 1>, say together',
      'with S1 using <Audio 1> and S2 using <Audio 2>, say together',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: mappedPrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).not.toThrow()

    const swappedPrompt = prompt.replace(
      'with S1 using <Audio 1>, say together',
      'with S1 using <Audio 2> and S2 using <Audio 1>, say together',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: swappedPrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_INVALID')

    const borrowedReversePairPrompt = prompt.replace(
      'with S1 using <Audio 1>, say together',
      'with S1 using <Audio 1> and <Audio 2> while S2 follows the melody, say together',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: borrowedReversePairPrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_INVALID')

    const oneSpeakerMultipleAudiosPrompt = prompt
      .replace(
        '<Audio 2> is the voice-timbre reference for <Subject 2> (S2).',
        '<Audio 2> is the pacing reference for <Subject 1> (S1).',
      )
      .replace(
        'with S1 using <Audio 1>, say together',
        'with S1 using the timbre of <Audio 1> and the pacing of <Audio 2>, say together',
      )
      .replace(
        'Then <Subject 2> (S2), using <Audio 2>, says <d>[Chinese]这是第二句。</d>',
        'Then an unbound narrator (S3) says <d>[Chinese]这是第二句。</d>',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: oneSpeakerMultipleAudiosPrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).not.toThrow()

    const partiallyNegatedPrompt = oneSpeakerMultipleAudiosPrompt.replace(
      'using the timbre of <Audio 1> and the pacing of <Audio 2>',
      'using <Audio 1> but not <Audio 2>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: partiallyNegatedPrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:2')
  })

  it('accepts two separately defined and applied audio references for one speaker', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).\n<Audio 2> is the voice-timbre reference for <Subject 1> (S1).',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.\n<Audio 2>: reference - The target speaker follows <Audio 2>\'s vocal timbre and measured delivery without copying the original signal.',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[Chinese]这是第一句。</d> Then <Subject 1> (S1), using the voice timbre referenced from <Audio 2>, says <d>[Chinese]这是第二句。</d>',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).not.toThrow()
  })

  it('resolves each Audio independently in a single-speaker multi-Audio phrase', () => {
    const basePrompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).\n<Audio 2> is the pacing reference for <Subject 1> (S1).',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre.\n<Audio 2>: reference - The target speaker follows <Audio 2>\'s pacing.',
      )
    const affirmativePrompt = basePrompt.replace(
      'using the voice timbre referenced from <Audio 1>, faces camera',
      'using the timbre of <Audio 1> and the pacing of <Audio 2>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: affirmativePrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).not.toThrow()

    const partiallyNegatedPrompt = basePrompt.replace(
      'using the voice timbre referenced from <Audio 1>, faces camera',
      'using <Audio 1> but not <Audio 2>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: partiallyNegatedPrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:2')

    const unrelatedUsingPrompt = basePrompt.replace(
      'using the voice timbre referenced from <Audio 1>, faces camera',
      'using <Audio 1> and using a handkerchief beside <Audio 2>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: unrelatedUsingPrompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:2')
  })

  it('allows the same speaker to stop using a bound Audio in a later vocal event', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[Chinese]这是第一句。</d> Then <Subject 1> (S1) speaks with a deliberately different natural voice and says <d>[English]Now I speak differently.</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()

    const compoundPrompt = prompt.replace(
      'Then <Subject 1> (S1) speaks with a deliberately different natural voice and says <d>[English]Now I speak differently.</d>',
      'Then <Subject 1> and a narrator (S1,S2), with S1 not using <Audio 1>, say together <d>[English]We are free.</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt: compoundPrompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('requires each audio reference to own a separate retention entry', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Subject 1> (S1) is the person shown in <Picture 1>.',
        '<Subject 1> (S1) is the first person shown in <Picture 1>.\n<Subject 2> (S2) is the second person shown in <Picture 1>.',
      )
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).\n<Audio 2> is the voice-timbre reference for <Subject 2> (S2).',
      )
      .replace(
        '[Shot 1] <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '[Shot 1] <Subject 1> (S1), using the voice timbres referenced from <Audio 1> and <Audio 2>, says <d>[Chinese]这是新台词。</d>.',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_RETENTION_MISSING:2')
  })

  it('rejects a different audio token inside another audio retention entry', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).\n<Audio 2> is the voice-timbre reference for <Subject 1> (S1).',
      )
      .replace(
        '<Audio 1>: reference - The target speaker follows <Audio 1>\'s vocal timbre and measured delivery without copying the original signal.',
        '<Audio 1>: reference - The target speaker follows <Audio 1> and <Audio 2>.\n<Audio 2>: reference - The target speaker follows <Audio 2>\'s vocal timbre.',
      )
      .replace('from <Audio 1>', 'from <Audio 1> and <Audio 2>')
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 2 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_RETENTION_INVALID:1')
  })

  it('requires an audio reference to be cited where its bound speaker uses it', () => {
    const prompt = referenceAudioPrompt.replace(
      ', using the voice timbre referenced from <Audio 1>',
      '',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('does not borrow an audio citation from another sentence on the same line', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      '<Subject 1> (S1) faces camera and says <d>[Chinese]这是新台词。</d>. After the dialogue, <Audio 1> remains the selected voice reference.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('allows a later dialogue event to begin using a bound Audio', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      '<Subject 1> (S1) says <d>[Chinese]第一句。</d>, then <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[Chinese]第二句。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('does not borrow a Subject and Audio binding from an earlier sentence', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, looks around. The camera holds. <Subject 1> (S1) says <d>[Chinese]这是新台词。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('does not borrow an Audio binding from another speaker in the same event', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Subject 2> (S2) is the second person shown in <Picture 1>.\n<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 2> (S2), using the voice timbre referenced from <Audio 1>, watches while <Subject 1> (S1) says <d>[Chinese]这是新台词。</d>',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('rejects an Audio reference applied to a different speaker even when its owner also uses it', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Subject 2> (S2) is the second person shown in <Picture 1>.\n<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      )
      .replace(
        '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '<Subject 2> (S2), using the voice timbre referenced from <Audio 1>, says <d>[Chinese]错误音色。</d>. Then <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[Chinese]这是新台词。</d>',
      )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_INVALID:1')
  })

  it('allows a balanced Ref dialogue block to span lines', () => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      '<d>[Chinese]这是\n新台词。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('keeps abbreviations inside the Audio-bound dialogue event', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      'Looking at Dr. Smith, <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('keeps unlisted title abbreviations inside the Audio-bound dialogue event', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      'Looking at Capt. Smith, <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each([
    '<Subject 1> (S1) faces Dr. Smith and, using the voice timbre referenced from <Audio 1>, says',
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, stands 1.5 meters away and says',
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, points at lamps, chairs, etc., and says',
  ])('does not treat token-internal punctuation as an Audio event boundary: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows an explicit leading Audio modifier in the same vocal event', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      'Using the voice timbre referenced from <Audio 1>, <Subject 1> (S1) faces camera and says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each([
    'Using <Audio 1>, a radio hums while <Subject 1> (S1) says',
    'Using <Audio 1>, the machine repeats a sound, and <Subject 1> (S1) says',
  ])('does not borrow a leading Audio modifier across an unrelated sound source: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('allows an explicit anaphoric bridge after a natural sentence boundary', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      'The timbre comes from <Audio 1>. <Subject 1> (S1) uses that timbre to say',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('does not carry a bound Audio from an earlier vocal event into a later dialogue', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, hums. Then says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('does not mistake an ordinary short proper noun for an Audio-event abbreviation', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, looks at Bob. Then says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it('allows a bound Audio to continue across a sentence when the final vocal event has an explicit bridge', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, studies the room. Then, using that timbre, says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it.each([
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, stands beside a sign bearing visible text reading "(S2)" and says',
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, stands beside a sign bearing visible text reading "STOP; WAIT" and says',
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, stands beside a display bearing visible text reading "At 00:09.000" and says',
    '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, stands beside a display bearing visible text reading "<Audio 2>" and says',
  ])('ignores visible-text protocol lookalikes while resolving an Audio-bound event: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('tracks the real cutoff block without matching a quoted cutoff literal', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[English]I am reading "<cutoff>".</d> Then <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, says <d>[Chinese]这是新台词<cutoff></d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('rejects substantive dialogue after the real cutoff even when it resembles visible-text syntax', () => {
    const prompt = referenceAudioPrompt.replace(
      '<d>[Chinese]这是新台词。</d>',
      '<d>[English]Wait<cutoff> reading "the rest of this sentence"</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:REFERENCE_DIALOGUE_CUTOFF_INVALID')
  })

  it('does not treat a visible-text Audio token as a timbre application', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      'A sign bearing visible text reading "<Audio 1>" hangs above <Subject 1> (S1), who says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    '<d>',
    '</d>',
    '[Shot 2]',
    'At 00:09.000',
    '<Audio 1>',
  ])('keeps a visible-text protocol lookalike opaque to Ref structure parsing: %s', (literal) => {
    const prompt = referencePrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      `[Shot 1] <Subject 1> stands beside a display bearing visible text reading "${literal}" and then turns toward the doorway.`,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).not.toThrow()
  })

  it.each([
    'Using the voice timbre referenced from <Audio 1>, <Subject 1> (S1) faces a U.S. naval officer and says',
    'Using the voice timbre referenced from <Audio 1>, <Subject 1> (S1) follows an e.g. cue and says',
    'Using the voice timbre referenced from <Audio 1>, <Subject 1> (S1) faces a U.S. Navy officer and says',
    'Using the voice timbre referenced from <Audio 1>, <Subject 1> (S1) follows e.g. Alice and says',
    'Using the voice timbre referenced from <Audio 1>, <Subject 1> (S1) pauses for .5 seconds and says',
  ])('keeps token-internal punctuation between a leading Audio citation and its speaker: %s', (speakerLead) => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      speakerLead,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('does not borrow a trailing Audio cue from an unrelated relative-clause subject', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1) watches a radio, which plays music and uses <Audio 1>, then says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:AUDIO_REFERENCE_APPLICATION_MISSING:1')
  })

  it.each([
    'using the clear youthful voice timbre referenced from <Audio 1>',
    'using the warm voice from <Audio 1>',
    'using the timbre and cadence from <Audio 1>',
  ])('allows descriptive official Audio-reference phrasing: %s', (audioPhrase) => {
    const prompt = referenceAudioPrompt.replace(
      'using the voice timbre referenced from <Audio 1>',
      audioPhrase,
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('allows the official follow-up voice-reference phrasing', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says',
      '<Subject 1> (S1) replies in the same clear youthful voice referenced from <Audio 1> with an amused cadence,',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('does not borrow an Audio binding across a semicolon-delimited vocal event', () => {
    const prompt = referenceAudioPrompt.replace(
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
      '<Subject 1> (S1), using the voice timbre referenced from <Audio 1>, hums; then says <d>[Chinese]这是新台词。</d>',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).toThrow()
  })

  it('allows an Audio-bound dialogue event to wrap across lines', () => {
    const prompt = referenceAudioPrompt.replace(
      ', using the voice timbre referenced from <Audio 1>, faces camera and says',
      ', using the voice timbre referenced from <Audio 1>,\nfaces camera and says',
    )
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
      references: { pictureCount: 1, audioCount: 1 },
    })).not.toThrow()
  })

  it('rejects dialogue owned only by a different subject and speaker', () => {
    const prompt = referenceAudioPrompt
      .replace(
        '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
        '<Subject 2> (S2) is the second person shown in <Picture 1>.\n<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      )
      .replace(
        '[Shot 1] <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, faces camera and says <d>[Chinese]这是新台词。</d>',
        '[Shot 1] <Subject 1> (S1), using the voice timbre referenced from <Audio 1>, watches while <Subject 2> (S2) says <d>[Chinese]这是新台词。</d>',
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
      prompt: nonReferencePrompt,
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
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
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
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
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
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
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
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
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
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
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
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] Her inherited motion continues. At 00:00.917, she turns toward the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
      timelineDurationSeconds: 5.167,
    })).not.toThrow()
  })

  it('does not apply Ref-only quoted-text parsing to continuation mode', () => {
    const prompt = continuationPrompt.replace(
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
      '[Shot 1] A sign says "Welcome" as she continues the inherited motion toward the doorway.',
    )
    expect(() => assertH3Prompt({
      inputMode: 'continuation',
      prompt,
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
    referencePrompt.replace(
      'summary:\n[reference generation] She turns toward the doorway while preserving <Subject 1> from <Picture 1>.\n\n\n',
      'summary:\n\n',
    ),
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
        '[reference generation] She turns toward the doorway while preserving <Subject 1> from <Picture 1>.',
        '[reference generation] She speaks the provided line. <d>[Chinese]不要走。</d>',
      ),
      reason: 'DIALOGUE_TAG_SECTION_INVALID:summary',
    },
  ])('rejects $name', ({ prompt, reason }) => {
    expect(() => assertH3Prompt({
      inputMode: 'reference',
      prompt,
    })).toThrow(`VIDEO_PROMPT_PROFILE_INVALID:${reason}`)
  })

  it('keeps cutoff unsupported outside the Ref mode contract', () => {
    const prompt = firstFramePrompt.replace(
      'turns, and settles',
      'says <d>[Chinese]不要<cutoff></d>, turns, and settles',
    )
    expect(() => assertH3Prompt({
      inputMode: 'first_frame',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID:DIALOGUE_CUTOFF_UNSUPPORTED')
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
      '[Shot 1] <Subject 1> notices the doorway, turns, and settles facing it.',
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
