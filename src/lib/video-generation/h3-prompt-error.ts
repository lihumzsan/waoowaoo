import type { MinimaxH3PromptSection } from './h3-prompt'
import { AppError } from '@/lib/errors/app-error'

type PromptIssueDescription = {
  readonly section: MinimaxH3PromptSection | null
  /** Instructions for the model, not localized UI copy. Null denotes a system/configuration defect. */
  readonly correction: string | null
}

// Every throw site selects a declared issue. Consumers use typed fields, never
// classify arbitrary exception messages or infer a missing source from dialogue.
export const H3_PROMPT_ISSUES = {
  SECTION_COUNT: { section: null, correction: 'Use exactly the six H3 section headings, each on its own line, in the director Skill order.' },
  SECTION_ORDER: { section: null, correction: 'Restore the declared H3 section order; the detail identifies the expected section.' },
  SECTION_EMPTY: { section: null, correction: 'Supply the required section content without inventing source facts.' },
  NON_DIEGETIC_MUSIC_CONTRACT_INVALID: { section: 'non_diegetic_music', correction: 'Set this section to N/A. Audience score belongs to the separate music operation.' },
  SUBTITLE_VISIBLE_TEXT_FORBIDDEN: { section: null, correction: 'Remove subtitle/caption directives, including negative directives, and visible dialogue translations from prompt prose. Keep spoken source lines verbatim inside <d> and describe the intended physical scene positively.' },
  DIALOGUE_CUTOFF_UNSUPPORTED: { section: 'detailed_description', correction: 'Use <cutoff> only in reference mode and only for a source-required interrupted final utterance.' },
  DIALOGUE_CUTOFF_SECTION_INVALID: { section: 'detailed_description', correction: 'Keep <cutoff> inside the final dialogue block in detailed_description.' },
  DIALOGUE_TAG_SECTION_INVALID: { section: null, correction: 'Move spoken source text into <d> blocks in detailed_description; do not repeat it in other sections.' },
  DETAILED_DESCRIPTION_SHOT_1_REQUIRED: { section: 'detailed_description', correction: 'Begin the shot sequence with [Shot 1], after the required style opening in reference mode.' },
  REFERENCE_STYLE_OPENING_REQUIRED: { section: 'detailed_description', correction: 'Add one or two English sentences establishing the source-backed visual style before [Shot 1].' },
  REFERENCE_STYLE_OPENING_INVALID: { section: 'detailed_description', correction: 'Use one or two English style sentences before [Shot 1], without dialogue, timestamps, or shot actions.' },
  CONTINUATION_TIME_SECTION_INVALID: { section: null, correction: 'Keep continuation timestamps in detailed_description, following the injected duration plan.' },
  CONTINUATION_TIME_FORMAT_INVALID: { section: 'detailed_description', correction: 'Use At MM:SS.mmm timestamps for continuation and the injected guide-relative timeline.' },
  SHOT_SEQUENCE_INVALID: { section: 'detailed_description', correction: 'Number actual shots consecutively from [Shot 1]. The detail identifies the expected shot.' },
  SHOT_TRANSITION_INVALID: { section: 'detailed_description', correction: 'Begin each later shot with [Shot N] At MM:SS.mmm, the camera cuts/dissolves/fades/wipes ...; preserve the intended cut and narrative.' },
  SHOT_TIME_OUT_OF_RANGE: { section: 'detailed_description', correction: 'Use increasing shot times within the injected prompt start/end. Split at a real semantic boundary if natural delivery exceeds the segment.' },
  SHOT_TRANSITION_ORPHANED: { section: 'detailed_description', correction: 'Give each actual camera transition exactly one later [Shot N] marker and timestamp; do not mark continuous motion as a cut.' },
  TIMED_EVENT_OUT_OF_RANGE: { section: 'detailed_description', correction: 'Place the identified event within the injected prompt start/end without speeding up or deleting source dialogue.' },
  REFERENCE_DIALOGUE_OUTSIDE_TAG: { section: null, correction: 'Keep verbatim dialogue only inside its <d> block, not repeated in summary, soundscape, or narrative prose.' },
  REFERENCE_NON_ENGLISH_TEXT_INVALID: { section: null, correction: 'Use English protocol prose; keep source-language dialogue inside <d> and explicitly required visible text in its literal slot.' },
  REFERENCE_RETENTION_SPEAKER_FORBIDDEN: { section: 'retention_analysis', correction: 'Remove (Sx) markers from retention entries; retain their speaker bindings in definitions and vocal events.' },
  REFERENCE_RETENTION_ENTRY_INVALID: { section: 'retention_analysis', correction: 'Use one <Subject/Picture/Audio N>: relationship - explanation entry per retained reference, as defined in the director Skill.' },
  REFERENCE_RETENTION_RELATION_INVALID: { section: 'retention_analysis', correction: 'Use a declared visual relationship for Subject/Picture and a declared audio relationship for Audio.' },
  REFERENCE_SUMMARY_PREFIX_REQUIRED: { section: 'summary', correction: 'Start with [reference generation], adding audio reference or audio reuse exactly as required by the audio retention relationships.' },
  CONTINUATION_PICTURE_ANCHOR_FORBIDDEN: { section: null, correction: 'Describe the frozen continuation guide facts without inventing Picture anchors.' },
  INPUT_MODE_UNSUPPORTED: { section: null, correction: null },
  DURATION_INVALID: { section: null, correction: null },
  FIRST_FRAME_ANCHOR_REQUIRED: { section: 'detailed_description', correction: 'Explicitly align <Picture 1> with the injected prompt start time in the opening shot.' },
  LAST_FRAME_ANCHOR_REQUIRED: { section: 'detailed_description', correction: 'Align <Picture 2> with the injected prompt end time as the final visual state.' },
  REFERENCE_VISUAL_DEFINITION_DUPLICATE: { section: 'subject_definitions', correction: 'Give the identified visual reference exactly one definition; merge its actual source-backed attributes.' },
  REFERENCE_SUBJECT_DEFINITION_INVALID: { section: 'subject_definitions', correction: 'Define each Subject on its own line, with one Subject identity and its actual Picture source(s).' },
  REFERENCE_SUBJECT_DEFINITION_DUPLICATE: { section: 'subject_definitions', correction: 'Keep one definition per Subject identity and use that same identity throughout the prompt.' },
  REFERENCE_PLAYBACK_SUBJECT_DEFINITION_INVALID: { section: 'subject_definitions', correction: 'Use the director Skill source-backed or target-visible in-scene playback entity definition, only for a real playback entity.' },
  REFERENCE_PLAYBACK_SUBJECT_AUDIENCE_CONFLICT: { section: 'subject_definitions', correction: 'Describe audible physical playback in the scene; audience-only score belongs to the separate music operation.' },
  REFERENCE_SUBJECT_UNDEFINED: { section: 'subject_definitions', correction: 'Define the referenced source-backed Subject with its actual Picture binding; describe source-established unreferenced extras in plain prose.' },
  REFERENCE_SUBJECT_SOURCE_MISSING: { section: 'subject_definitions', correction: 'Bind this Subject to the actual ready Picture source(s). For a source-established extra without a reference image, use plain description and a stable speaker ID instead of an unbound Subject. Do not remove principal-character references or invent a Picture source.' },
  REFERENCE_VISUAL_RETENTION_MISSING: { section: 'retention_analysis', correction: 'Add the identified defined visual reference with its actual retention relationship.' },
  REFERENCE_VISUAL_RETENTION_DUPLICATE: { section: 'retention_analysis', correction: 'Keep exactly one retention entry for the identified visual reference.' },
  REFERENCE_VISUAL_RETENTION_SHOT_INVALID: { section: 'retention_analysis', correction: 'Reference only shots that actually exist in detailed_description.' },
  REFERENCE_VISUAL_APPLICATION_MISSING: { section: 'detailed_description', correction: 'Use the defined visual label where its reference actually applies. Correct genuinely unused reference selection explicitly; do not drop required assets to pass validation.' },
  REFERENCE_VISUAL_UNDEFINED: { section: 'retention_analysis', correction: 'Use a defined Subject or independent Picture in retention. A Picture used only as a Subject source needs no separate retention entry.' },
  REFERENCE_PICTURE_UNUSED: { section: 'subject_definitions', correction: 'Bind this submitted Picture to its actual Subject(s), or define and apply it as an independent composition reference. Do not fabricate a use.' },
  REFERENCE_MANIFEST_INVALID: { section: null, correction: null },
  VIDEO_REFERENCE_UNSUPPORTED: { section: null, correction: 'Use only media labels supported by the frozen input mode; do not invent <Video N> for H3 reference mode.' },
  MEDIA_REFERENCE_INDEX_OUT_OF_RANGE: { section: null, correction: 'Use only existing Picture/Audio numbers in frozen channel order. Context references do not consume Picture numbers.' },
  AUDIO_REFERENCE_MISSING: { section: 'subject_definitions', correction: 'Define each submitted Audio exactly once, with its real speaker binding or unbound audible purpose.' },
  AUDIO_SPEAKER_BINDING_INVALID: { section: 'subject_definitions', correction: 'Bind one Audio to one actual Subject/Speaker or stable voice description plus (Sx). Do not invent a speaker for unbound ambience or synchronized cues.' },
  AUDIO_REFERENCE_RETENTION_MISSING: { section: 'retention_analysis', correction: 'Add one retention entry for this Audio using its actual official audio relationship, without (Sx).' },
  AUDIO_REFERENCE_RETENTION_INVALID: { section: 'retention_analysis', correction: 'Give this Audio one entry using fully_copy, partially_copy, reference, or weak_reference; do not mix another Audio label into the entry.' },
  AUDIO_REFERENCE_APPLICATION_MISSING: { section: null, correction: 'Explicitly apply this Audio to its intended speaker in the same vocal event as (Sx) and <d>. Unbound audio must be cited in its actual audible layer. Preserve required voice references.' },
  AUDIO_REFERENCE_APPLICATION_INVALID: { section: 'detailed_description', correction: 'Apply the Audio to its defined speaker in the same shot/phase and vocal event. Do not borrow a different speaker or a reference across an event boundary.' },
  AUDIO_SPEAKER_DIALOGUE_MISSING: { section: 'detailed_description', correction: 'Use the bound speaker ID in its intended source-backed dialogue event; correct an unused audio selection explicitly without inventing dialogue.' },
  PROMPT_EMPTY: { section: null, correction: 'Provide the complete final prompt with all six H3 sections.' },
  PROFILE_UNKNOWN: { section: null, correction: null },
  REFERENCE_DIALOGUE_TAG_INVALID: { section: 'detailed_description', correction: 'Use balanced, non-nested <d>...</d> blocks for spoken source text.' },
  REFERENCE_DIALOGUE_CONTENT_INVALID: { section: 'detailed_description', correction: 'Put [Language] and verbatim dialogue inside <d>; complete sentences need .?! or 。！？ before </d>. Only source-required cutoff or paired scenetrans permits an unfinished ending. Do not delete or rewrite dialogue to pass.' },
  REFERENCE_DIALOGUE_CUTOFF_INVALID: { section: 'detailed_description', correction: 'Use <cutoff> only for the explicitly interrupted last utterance, at its end; its </d> must finish detailed_description.' },
  REFERENCE_QUOTED_TEXT_CONTEXT_INVALID: { section: null, correction: 'Use <d> for speech. Reserve escaped ASCII quoted literals for explicitly source-required visible text with a valid visible-text carrier.' },
  REFERENCE_SCENETRANS_INVALID: { section: 'detailed_description', correction: 'Pair trailing and leading <scenetrans> inside adjacent dialogue blocks across a real cut, with explicit audible continuity. Preserve source words.' },
} as const satisfies Record<string, PromptIssueDescription>

export type H3PromptIssueCode = keyof typeof H3_PROMPT_ISSUES

export class H3PromptValidationError extends AppError {
  readonly issueCode: H3PromptIssueCode
  readonly section: MinimaxH3PromptSection | null
  readonly detail: string | null
  readonly correction: string | null

  constructor(code: H3PromptIssueCode, detail?: string, section?: MinimaxH3PromptSection) {
    const description = H3_PROMPT_ISSUES[code]
    super(
      description.correction === null ? 'INTERNAL_ERROR' : 'INVALID_PARAMS',
      `VIDEO_PROMPT_PROFILE_INVALID:${code}${detail === undefined ? '' : `:${detail}`}`,
      {
        context: { system: 'application', phase: 'h3_prompt_validation' },
        details: { reasonCode: 'VIDEO_PROMPT_PROFILE_INVALID', field: 'prompt' },
      },
    )
    this.name = 'H3PromptValidationError'
    this.issueCode = code
    this.section = section ?? description.section
    this.detail = detail ?? null
    this.correction = description.correction
  }
}
