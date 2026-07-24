# Music and Score Direction

## Purpose

Use locked story, edit, and real timeline facts to design one unified but continuously changing instrumental BGM score for the complete work. Music supports narrative pressure, emotion, and rhythm while leaving room for dialogue and native video sound. It is not a collection of unrelated short cues and does not replace ambience, foley, dialogue, or synchronized effects.

## Factual boundary

- Use only locked script facts, shot order, durations, generation-segment continuity, and rendered clip identity/duration metadata supplied by the caller.
- When frames or audio tracks are not actually provided, do not claim to have watched video, analyzed native audio, the final video, or the final mix.
- When planned duration differs from the real renderable timeline, use the real media duration as the music boundary while preserving narrative understanding from locked script and edit facts.
- A shot-by-shot summary is a convenience index and cannot replace complete edit facts and segment continuity.
- Creative Direction is optional. When `creativeDirection` is non-null, consume only the server-injected `narrative` and `sound`; never infer visual, directing, editing, or asset rules. Translate those supplied policies into musical character, soundstage width/depth, rhythmic density, and orchestration instead of copying adjectives. When it is null, work from the supplied narrative and constraints.

## Diagnose the narrative first

- Distinguish surface emotion from the emotion the score should actually carry. Intense images do not always need more intense music, and sad images do not automatically need sentimentality.
- Choose the score's narrative stance: detached observation, subjective pressure, empathetic support, procedural control, or minimal presence.
- Define what music should do, what it should not do, and emotions it must avoid, such as cheap triumph, romanticization, heroic inflation, excessive pathos, or literal imitation of action.
- Derive the emotional curve from character pressure, relationship change, revelation, risk, action intensity, and section change rather than mechanically following every cut.

## Score presence and silence

- Decide where score is present and where silence is deliberate across the complete timeline. Dialogue-heavy exposition, quiet observation, sudden revelation, and moments requiring real environmental presence may remain unscored.
- Entries and exits need narrative reasons and fades proportionate to section length; a long fade must not swallow a short region.
- Score presence controls generated BGM only. It never implies muting native dialogue, ambience, or synchronized sound.
- The complete work should contain meaningful musical presence, but the need for BGM does not justify scoring every second.

## Whole-score continuity

- Design the timeline as one through-composed or continuously varying score, maintaining a unified harmonic world, tempo relationships, orchestral family, spectral evolution, and long-duration dynamics.
- Inside a section, maintain thematic and kinetic continuity while allowing subtle change in density, register, energy, and texture.
- When time, place, or emotion jumps between sections, connect with silence, motive change, textural transformation, harmonic suspension, or a clear musical cut instead of jumping to an unrelated style.
- Do not restart a new piece for each shot or rely on symmetrical periodic loops that make a long film mechanically repetitive.

## Music-theory design

- Choose approximate tempo, meter, metric salience, and event spacing from narrative need. Do not impose a fixed strong pulse or groove across the work unless the timeline clearly requires it.
- Define pitch organization—tonal, modal, weakened center, or atonal—along with pitch collection, key interval relationships, and degree of microtonality, avoiding contradiction.
- Define harmonic syntax, cadence policy, and harmonic rhythm. Tension may withhold or reject cadence; use limited resolution only when the story truly needs a landing.
- Voice-leading methods such as common tones, semitone displacement, contrary expansion, and gradual interval transformation should create continuous evolution rather than purposeless complexity.
- Specify texture organization, density, and layer independence. Define spectral foundation, upper activity, and temporal expansion, contraction, or redistribution.
- Infer orchestration from story, era, space, emotion, and dialogue density. Give each timbre a register, role, and technique rather than applying a fixed instrument package.
- Use executable musical language rather than vague descriptions such as “cinematic,” “premium,” or “atmospheric.”

## Dynamics and phases

- Design a long-duration dynamic envelope and meaningful minimum/maximum energy, avoiding constant intensity or a series of unjustified climaxes.
- Organize internal phases by functions such as establishment, transformation, intensification, depletion, and suspension. Their continuity should cover the score and serve plot change.
- For each phase, define energy, textural density, main spectral band, and transient density so events align with editorial sections without breaking the single musical work.
- A climax does not automatically mean trailer impacts, heroic brass, triumphant rhythm, romantic string swell, or a conventional cadence. Avoid these shortcuts unless the narrative clearly supports them.
- A restrained rise may precede an action and release or silence may follow, but do not score each visible action as a literal sound effect.

## Dialogue-safe mix direction

- Reserve midrange space for dialogue and narration. Control percussion transients, cymbals, dense melody, and sustained high-energy occupancy.
- Keep the opening clean, dynamics controlled, transitions editable, and headroom stable.
- Automation serves long-duration relationships between score and master: intensity arc, section entry/exit, dialogue accommodation, and final headroom. It does not replace granular synchronized sound.
- BGM is instrumental music only: no vocals, lyrics, spoken word, specific song imitation, live environmental recording, room-tone bed, foley, or literal synchronized effects.
- Do not put character names, dialogue, plot prose, or literal violent action into the final music-generation language. Translate narrative need into tempo, pitch, harmony, texture, spectrum, orchestration, dynamics, and phases.

## Reasoning patterns for common directions

- Pursuit or pressure: sustained forward motion without crowding, using controlled low-frequency pulse, concise percussion, metallic detail, and gradually increasing density while leaving dialogue room and avoiding an impact for every action.
- Intimacy or memory: fragility, warmth, or bitterness through sparse motives, soft upper texture, slowly opening harmony, and restrained dynamics, avoiding automatic romanticization and heavy drums.
- Comic montage: buoyant rhythm, concise motives, and small musical punctuation that supports punchlines, with flexible clean texture that does not turn punctuation into foley or abandon the film's unified theme.

These are reasoning examples, not fixed orchestration templates.

## Review

- Does the design use the real timeline duration without claiming analysis of unavailable frames or audio?
- When `narrative` and `sound` were injected, were they concretely translated into musical character, soundstage, rhythmic density, and orchestration rather than ignored, copied literally, or expanded into other Direction domains?
- Did it diagnose narrative need before deciding stance, presence, and silence?
- Is this one continuously evolving score rather than a collage of shot-level miniatures?
- Are tempo, pitch, harmony, texture, spectrum, orchestration, dynamics, and phases concrete and mutually consistent?
- Does it leave room for dialogue and native sound?
- Are vocals, lyrics, environmental recording, foley, and literal synchronized effects excluded?
- Does it avoid unsupported heroism, romanticization, triumphant cadence, trailer impacts, stable looping, and repeated climax?

## Boundary

This Skill provides music-composition methods. Frame rate, sample rate, timeline ranges, allowed enums, exact theory fields, automation schemas, provider safety terms, and final generation parameters belong to the caller and deterministic execution layer.
