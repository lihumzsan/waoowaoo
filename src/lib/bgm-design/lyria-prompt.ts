import { framesToSeconds, type BgmDesignClock, type MusicTheorySpec, type ScoreCue } from './types'

const PROHIBITION_LABELS: Record<MusicTheorySpec['prohibitions'][number], string> = {
  vocals: 'pitched vocal timbres',
  lyrics: 'lyrical phoneme sequences',
  spoken_word: 'speech-rate prosody and intelligible vocal articulation',
  literal_sound_effects: 'non-pitched concrete-source transients',
  environmental_recordings: 'non-musical broadband noise beds',
  functional_dominant_tonic: 'functional dominant-tonic syntax',
  authentic_cadence: 'dominant-tonic authentic cadence and tonal confirmation',
  heroic_brass: 'foreground brass fanfare intervals and parallel triadic voicing',
  triumphant_rhythm: 'major-mode cadential arrival with metrically reinforced pulse',
  romantic_swell: 'foreground legato string melody with consonant resolution',
  cathartic_climax: 'global energy apex followed by consonant tonal stabilization',
  trailer_impacts: 'isolated broadband orchestral transients and low-frequency accent punctuation',
  stable_groove: 'isochronous groove and periodic beat reinforcement',
  periodic_phrase_cycle: 'symmetrical phrase recurrence and periodic sectional repetition',
}

const FORBIDDEN_NARRATIVE_TERMS = [
  /\bblood(?:y)?\b/i, /\bgore\b/i, /\bgory\b/i, /\b(?:violent|violence)\b/i,
  /\btortur(?:e|ed|ing)\b/i, /\bkill(?:ed|ing)?\b/i, /\bmurder\b/i, /\bweapon\b/i,
  /\bgun\b/i, /\bknife\b/i, /\binjur(?:y|ed)\b/i, /\bwound(?:ed)?\b/i,
  /血|暴力|血腥|折磨|杀|武器|枪|刀|受伤|伤口/,
] as const

function term(value: string): string {
  return value.replace(/_/g, ' ')
}

function list(values: readonly string[]): string {
  return values.join(', ')
}

export function assertLyriaPromptSafe(prompt: string): void {
  const match = FORBIDDEN_NARRATIVE_TERMS.find((pattern) => pattern.test(prompt))
  if (match) throw new Error(`LYRIA_PROMPT_POLICY_VALIDATION_FAILED:${match.source}`)
}

export function buildLyriaPrompts(input: {
  readonly cue: ScoreCue
  readonly clock: BgmDesignClock
}): { readonly prompt: string; readonly negativePrompt: string } {
  const spec = input.cue.musicTheorySpec
  const cueFrames = input.cue.range.endFrameExclusive - input.cue.range.startFrame
  const phaseText = spec.phases.map((phase) => {
    const start = Math.round((phase.range.startFrame - input.cue.range.startFrame) / cueFrames * 100)
    const end = Math.round((phase.range.endFrameExclusive - input.cue.range.startFrame) / cueFrames * 100)
    return `${term(phase.function)} ${start}-${end}%, ${term(phase.density)} density, ${Math.round(phase.energy * 100)}% energy, ${term(phase.spectralBand)} focus`
  }).join('; ')
  const orchestration = spec.orchestration.map((part) => (
    `${term(part.instrument)} in ${term(part.register)} register as ${term(part.role)}, using ${list(part.techniques.map(term))}`
  )).join('; ')
  const center = spec.pitch.centerPitch ? ` centered on ${spec.pitch.centerPitch}` : ''
  const prompt = [
    `Instrumental ${term(spec.form)} cinematic underscore, ${framesToSeconds(cueFrames, input.clock).toFixed(3)} seconds.`,
    `Tempo ${spec.bpm} BPM in ${spec.meter}; ${term(spec.metricSalience)} metric salience and ${term(spec.eventSpacing)} event spacing.`,
    `Pitch: ${term(spec.pitch.centerType)}${center}, ${term(spec.pitch.collection)}; ${list(spec.pitch.intervalRelations.map(term))}; ${term(spec.pitch.microtonality)} microtonality.`,
    `Harmony: ${term(spec.harmony.functionalSyntax)} functional syntax, ${term(spec.harmony.cadencePolicy)}, ${term(spec.harmony.harmonicRhythm)} harmonic rhythm.`,
    `Voice leading: ${list(spec.voiceLeading.map(term))}.`,
    `Texture: ${term(spec.texture.organization)}, ${term(spec.texture.density)} density, ${Math.round(spec.texture.layerIndependence * 100)}% layer independence.`,
    `Spectrum: ${list(spec.spectrum.foundation.map(term))} foundation, ${term(spec.spectrum.upperActivity)} upper activity, ${term(spec.spectrum.evolution)} evolution.`,
    `Orchestration: ${orchestration}.`,
    `Dynamics: ${term(spec.dynamics.envelope)}, ${term(spec.dynamics.transientPolicy)} transients, ${Math.round(spec.dynamics.minimumEnergy * 100)}-${Math.round(spec.dynamics.maximumEnergy * 100)}% energy.`,
    `Continuous phases: ${phaseText}.`,
    'Maintain continuous harmony, tempo, orchestration, spectral evolution, and long-duration dynamics across the complete cue.',
    'Keep midrange headroom and restrained transient occupancy for dialogue-safe downstream mixing.',
  ].join(' ')
  const negativePrompt = list(spec.prohibitions.map((item) => PROHIBITION_LABELS[item]))
  assertLyriaPromptSafe(prompt)
  assertLyriaPromptSafe(negativePrompt)
  return { prompt, negativePrompt }
}
