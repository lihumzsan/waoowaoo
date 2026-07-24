# Continuity Memory

## Purpose

Extract the minimum sufficient project facts that support long-form, chaptered, and parallel production: stable canon, major entities, narrative beats, persistent state changes, emotional regions, and source evidence. It records facts already established by the work; it does not continue writing the story or design shots.

For `outputKind=story_canon`, Creative Direction is optional. When `creativeDirection` is non-null, consume only its server-injected `narrative` policy as guidance for framing and emphasis; never turn presentation policy into a canon fact. `continuity_analysis` receives no Creative Direction.

## Source discipline

- The source text is the only factual authority. Do not record a name, identity, location, rule, event, motive, or ending without textual support.
- Conservative high-confidence summaries are allowed only when they can be traced back to evidence. Genre convention and common sense cannot replace evidence.
- Merge multiple names for the same character or location into one entity and preserve aliases. A change in wording must not create a duplicate entity.
- Separate stable global facts from one-time action: lasting information belongs to canon; events that change later understanding belong to state transitions; momentary action without persistent effect does not belong in memory.
- Model text must not invent database identities. Use short references or exact names supplied by the caller; the external system resolves canonical identity.

## Stable global layer

### Story overview

- The overview covers the main conflict, relationships, emotional direction, and ending or current textual endpoint.
- Provide a title or logline only when directly present or confidently summarizable. Omit uncertain claims.

### Characters

- Include recurring characters and people necessary to understand the story, not passersby, one-off generic labels, or environmental description.
- Record stable identity, relationships, desire, constraints, baseline state, and narrative function rather than treating a momentary action as a permanent trait.
- When an intrinsic voice is needed, describe only stable controllable timbre: age/gender impression, pitch and weight, and vocal texture.
- An intrinsic voice must not include pace, pauses, loudness, current emotion, phrase endings, whispering, shouting, crying, or other momentary performance. Do not reference actors, celebrities, brands, or protected voices.
- Infer voice conservatively only from explicit text or well-supported identity, age, physical condition, and long-term temperament.

### Locations and world rules

- Include locations meaningful to spatial continuity, atmosphere, or plot. Do not turn ordinary objects or one-time directions into locations.
- Record stable spatial traits, atmosphere, function, and narrative role without mixing in one-time character action.
- World rules contain lasting background facts, constraints, relationships, and causal rules, not isolated events.

### Style tendency

- Infer visual tone, camera-language tendency, editing rhythm, color, and lighting direction only from the source's genre, emotion, pacing, and spatial description.
- Do not replace evidence with generic cinematic language, and do not turn an inferred style tendency into a new plot fact.

## Narrative beats

- A beat is the smallest complete narrative advance, usually an action, discovery, choice, relationship change, emotional turn, scene advance, goal change, or escalation of risk.
- Beats follow source order, do not overlap, and cover all meaningful story content. Skip only blank, purely structural, or irrelevant decorative text.
- Split at natural turns rather than arbitrary character counts, and do not place several independent advances in one oversized beat.
- Merge lines too small to contain an independent change into an adjacent beat. Split an oversized beat at a natural narrative turn.
- Estimate beat duration from actual dialogue, action, reaction, pause, and transition time. A simple action may last seconds; only complex drama needs longer.
- More beats do not imply a longer work. Their combined duration should approximate the script's real performance scale.
- A source anchor should use verbatim, locally unique phrases sufficient to find the passage again, without paraphrase, summary, or ellipsis.

### Duration estimation method

- Convert dialogue at real speaking pace: roughly 4–6 Chinese characters per second, or about 150–180 English words per minute. Take the faster end for fast-paced genres and the slower end for grave, grieving, or threatening lines. Compute how long the lines actually take to speak instead of assigning fixed seconds per line.
- Take the longest item for simultaneous content instead of adding them. Voice-over, inner monologue, and narration run at the same time as the picture action they cover; a character speaking while walking, or shouting while fighting, is likewise counted once. Add durations only for actions that genuinely happen in sequence.
- Give pauses only where they are earned: a major reveal, an emotional landing, a punchline button, or a threat turn may take an explicit 0.5–2 seconds. Ordinary reactions, glances, blocking, and head turns are not timed separately.
- Cuts and shot transitions themselves take no duration.
- Set the pacing tier by genre: vertical short drama and hook-driven short video are estimated at the shortest duration in which the audience still follows cause and effect, keeping action and dialogue running in parallel; slow emotional drama, arthouse work, and suspense build-ups are estimated at natural performance pace and must not lose necessary silence, breath, or negative space for the sake of speed.
- The estimate is real performance time, not a target duration. Never inflate estimates to reach some total, and never cut the action required to understand cause and effect to look compact.

## Persistent events and state

- Record only changes that continue to affect later material: identity reveals, character appearance or physical state, relationships, location, object possession or damage, plot facts, world rules, and emotional states with lasting effect.
- Ordinary walking, looking, brief pauses, ambience, and performances without consequences are not persistent events.
- Bind each event to one clear beat; its evidence must not span several beats.
- List only directly involved entities. Character and location names must match confirmed names or aliases; do not guess an unmatched identity.
- A persistent fact is phrased as something that remains true after the event. A brief appearance or emotion without an enduring state is not a persistent fact.
- Track both entry and exit state: who is where, who knows what, who holds what, relationship status, body and wardrobe state, established rules, and unresolved goals or clues.

## Emotional regions

- Divide the source into regions with relatively stable emotion or rhythm rather than creating a cue for every sentence.
- Use short, concrete dominant emotions such as “suppressed suspicion,” “brief relief,” or “approaching danger.”
- Intensity must reflect actual risk, conflict, emotional pressure, and action, retaining genuine variation rather than labeling everything intense.
- Music tendency distinguishes silence, low-presence underscore, thematic motive, and transitional support. Dialogue-heavy exposition and quiet observation may deliberately remain unscored.
- Emotional analysis does not prescribe exact instruments, melodies, lyrics, tracks, exact music duration, or mixing instructions.

## Minimum sufficient chapter context

For local production, select only:

- the relevant source and beats;
- applicable global rules;
- involved characters, locations, and props;
- state still true at chapter entry;
- required chapter events and exit changes;
- information needed to connect adjacent chapters;
- confirmed but unresolved conflicts, clues, and unknowns.

Do not copy the entire project indiscriminately into every local task, but do not compress away facts that change behavior, asset appearance, object ownership, or narrative causality.

## Review

- Does every stable fact, event, and emotional judgment have source support?
- Are characters, locations, and aliases deduplicated?
- Has any momentary action, shot design, or generic genre convention been mistaken for persistent fact?
- Are beats split at natural turns, complete in coverage, and credible in duration?
- Is the post-event state sufficient for later chapters to work in parallel without rewriting facts?
- Are unknowns and contradictions preserved rather than silently invented away?

## Boundary

This Skill provides fact extraction and continuity methods. Entity IDs, source-coordinate fields, enums, JSON schemas, persistence shape, and state writers are defined by the caller.

## Continuity judgment for Chapter planning

- When `outputKind=chapter_plan` and this Skill is supplied, use narrative state changes, cross-section dependencies, persistent entity state, and emotional regions to identify natural boundaries. Do not turn fact extraction back into a fixed splitter.
- The exact screenplay Revision remains the authority for every Chapter range. A Story Canon or continuity material may explain shared facts in that screenplay, but cannot add source text, override its ranges, or become a prerequisite for planning Chapters.
- Avoid cutting through an unfinished persistent state transition. When a dependency truly crosses Chapters, state the adjacent units' entry and exit conditions clearly in their summaries without creating another global canon.
- The 180-second ceiling is only a local validation rule after Chapters have been chosen. Whether Chapters are useful still depends on independent work value, parallelism, context bounds, and recovery needs.
