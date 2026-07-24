# Director and Production Timeline Core

## Purpose

Turn established story facts into an executable production timeline: why each shot exists, what happens on screen, how characters perform, what dialogue and synchronized sound occur, which consecutive shots can be generated together, and which shot scale and camera motion each shot uses.

This is one unified layer of directing knowledge. A caller may request the complete timeline or only one scope. When working on one scope, never rewrite already approved parts outside it.

## Skill reading composition

- For `outputKind=video_prompt_set`, read `director-core`, `video-direction`, and `quality-review` before creating the result. This Skill owns directing judgment, `video-direction` writes applicable knowledge into the sole final prompt, and `quality-review` performs the pre-output review.
- These three Skills are a knowledge composition inside one generic Worker run, not three serial Subagents and not three outputs. Return only the strict `video_prompt_set`, with all professional judgment internalized into each segment's sole `prompt`.

## Factual boundary

- The script, global canon, entry state, current events, approved assets, and user requirements are the only plot facts.
- Do not invent dialogue, characters, locations, props, motives, or outcomes absent from the script. Dialogue remains verbatim.
- When assets are constrained, use only explicitly supplied character and location names; never resolve identity through approximate wording.
- Directing organizes facts. It does not gain authority to modify world canon or persistent state.

## Narrative shot structure

- Every shot has a clear purpose, such as establishing space, advancing action, showing reaction, revealing detail, building atmosphere, or completing a transition.
- Duration follows visible action, performance, dialogue, audience comprehension time, and emotional landing. Do not assign the same template duration to every shot.
- The scene identifies an approved location and the local area used in this shot. Do not turn a sub-area of the same location into a new location identity.
- Action describes only visible events and changes, not internal explanation or production process.
- For each performing character, describe visible expression, body action, pauses, reaction, and movement. Do not mix blocking, screen coordinates, gaze coordinates, or camera staging into performance.
- Preserve dialogue verbatim and ensure the speaker is actually present in the shot. Do not add narration when no dialogue exists.
- Synchronized sound contains only short sounds tied to visible action, such as steps, doors, impacts, cloth, or machinery. Do not place continuous ambience beds or BGM in shot sync sound.
- Establishing shots, reactions, inserts, and transitions must carry information, scale, suspense, comedy timing, gaze guidance, or emotional change; never add them mechanically.
- Judge the relationship between shots before choosing a transition. Continuous action and ordinary angle changes in the same time and place usually connect naturally; design a creative transition only when a time/place jump, compression, emotional turn, or visual metaphor gives it real value.

## Blocking and staging

- Think about performance and blocking separately: performance covers expression, body action, and reaction; blocking covers position, orientation, relationships, and movement within visible space.
- When placement affects action legibility, character relationships, composition, or cross-shot continuity, establish the first visible arrangement and the shot's landing position. Prefer a concise combination of stable physical anchor, frame region or foreground/midground/background depth, body orientation, and relationship to a prop or another character—for example, “at the left end of the chart table in the left third of frame, body facing the storm window, right hand on the brass radio.”
- Use natural frame regions and physical set features, not pixel coordinates, and keep camera staging out of performance description. An empty establishing shot, isolated prop insert, or unambiguous detail shot may omit character blocking.
- When a character changes position, make the starting point, path, and landing position visible. After arrival, inherit that result in later relevant shots through the same physical anchor, region, orientation, or prop relationship.
- In multi-character shots, state distance, depth order, and set anchors when the narrative needs them. Preserve screen direction only when action direction or an eyeline relationship depends on the spatial axis.

## Rhythm and emotional release

- Use the opening seconds to establish the hook, space, and main pressure according to genre. Fast pacing must not remove actions needed to understand causality.
- Keep ordinary action concise. Major revelations, spectacle, and key emotion need sufficient time for “signal or detail — full reveal — reaction or scale comparison.”
- Comedy values reaction pauses and punchline landing; suspense controls information and gaze order; drama protects the causality of choice; action protects readable movement and endpoints.
- Set the pacing tier by genre: vertical short drama and hook-driven short video build every shot at the shortest duration in which the audience still follows cause and effect, running action and dialogue in parallel where possible; slow emotional drama, arthouse work, and suspense build-ups keep natural performance pace with the silence and breath they need.
- Safe to compress or pass over quickly: travel and repositioning, repeated observation, purely expository voice-over, transitional action carrying no new information, and simple capture or restraint procedures.
- Must be given enough time: identity reveals, key reactions, punchline landings, threat and relationship turns, violence endpoints, and the closing hook. A fast pacing tier never removes these.
- Dialogue, voice-over, inner monologue, and picture action that happen at the same time advance on one timeline; their durations are not added in sequence.
- Shots form an attention flow, action flow, and emotional curve instead of functioning as isolated attractive images.

## Generation segmentation

- Complete narrative shot and directing design first, then pack continuous shots into independent generation segments. Segmentation is not a fixed-duration shot template chosen in advance.
- `productionContext.video.allowedSegmentDurationsSeconds`, its minimum/maximum, and aspect ratio are authoritative execution facts. When the material is substantial enough, minimize independent generations and pack continuous material toward the maximum allowed duration (currently often 15 seconds). Never repeat action, stretch performance, extend uninformative pauses, or add empty content to fill time or reduce generation count.
- Choose a shorter allowed duration only for a discontinuity in time, place, character state, scene, or unfinished-action continuity, or when an exact total-duration remainder requires it.
- `durationIntent` is the sole duration authority: with `mode=fixed`, all generation durations must sum exactly to `seconds`; with `mode=derive`, the total follows what the content genuinely needs, and planning estimates in the context (such as a Chapter `targetDurationSec` or beat estimates) are reference facts, never a budget to fill.
- Group sequential shots that can share continuity of action, performance, space, emotion, props, and synchronized sound.
- Each segment completely and sequentially covers its shots and respects the current model's single-generation duration limit. Never omit, reorder, or force discontinuous shots together.
- Do not split one unfinished action across independent generations. Every independent segment has an established entry state, local task, and ending point.
- Design every pair of adjacent independent segments together. The outgoing final shot and incoming first shot use visibly different scales; with the same character in the same location, a side/back view or slight camera-angle change cannot replace a scale change. When the character next becomes an identifiable on-screen subject, inherit placement through stable set anchors.
- Continuity includes only facts that must remain stable within the segment: action, performance, space, emotion, props, and synchronized sound. Do not restate the whole story or use editing meta-language.
- When time, place, or state jumps, begin another segment rather than forcing a generative model to interpolate between disconnected spaces.

## Shot scale and camera motion

- Scale serves information and emotion: wide shots establish space and scale; medium shots show relationship and action; medium-close shots balance performance and context; close-ups carry emotion; inserts reveal critical detail.
- Choose one primary camera-motion intention per shot, such as locked, push-in, pull-back, lateral move, follow, or orbit. Motion helps reveal action, information, or subjectivity; it does not move merely to feel cinematic.
- Stability follows narrative need: locked or stable for spatial clarity, dialogue, and control; smooth for guidance and immersion; subtle shake or handheld only when subjective pressure, pursuit, or instability benefits from it.
- Visual style may influence motion texture and breathing room but cannot rewrite plot, performance, or spatial facts.
- Avoid conflicting simultaneous moves, trajectories impossible within the duration, or camera motion that hides the key performance.

## Whole-timeline consistency

- Editorial intent and execution design share one shot reference. When a shot is added, removed, or reordered, narrative, execution, generation segment, and result selection must continue to point to the same shot concept.
- Decide why the shot exists and what happens before deciding scale and motion. Camera motion must not manufacture plot that does not exist.
- Once a character has stood, taken an object, turned, or arrived, the next shot begins from the new state rather than accidentally replaying the action.
- Across shots preserve identity and wardrobe, physical state, prop ownership, major movement direction, emotional intensity, core set objects, and continuing sound.
- Compare the exit and entry state of adjacent shots so action direction, information state, and audience attention connect.

## Scope-sensitive delivery

Directing decisions are first an internal creative process. Deliver separate process structure only when the caller's contract has a real consumer for it. When the goal is a final video prompt, write every applicable shot, performance, action, continuity, sound, and transition decision into that one prompt instead of restating a parallel directing plan.

- For editorial structure only: decide purpose, duration, scene, action, performance, dialogue, synchronized sound, and generation grouping. Do not add scale, camera position, composition, lighting, movement, or final generation prompts.
- For shot execution only: cover the supplied shots in their original order and add only scale, primary movement, and stability. Do not rewrite story, action, performance, dialogue, or synchronized sound.
- For a unified Production Timeline: clearly separate editorial, execution, and later result selection under the same shot, without allowing result state to rewrite approved creative facts.

## Review

- Does the plan use only established facts and approved assets while preserving dialogue verbatim?
- Does every shot have a clear narrative function, visible action, and credible duration?
- Are performance and blocking described separately, with necessary placement expressed through visible physical anchors, frame region, orientation, and relationships?
- Does sync sound contain only synchronized short sounds, without BGM or a continuous ambience plan?
- Are generation segments sequential, complete, within capability limits, and free of actions split across generations?
- Do scale and movement serve rather than overwrite the editorial plan?
- Are entry and exit states, props, character state, and emotion continuous between adjacent shots?
- Was every adjacent independent-segment pair checked, with a genuinely visible scale change between the outgoing final shot and incoming first shot?

## Boundary

This Skill provides unified directing methods. System identities, allowed durations, strict output schemas, and execution parameters belong to the caller and execution layer. For `outputKind=video_prompt_set`, follow the three-Skill reading composition above; for other tasks, read only knowledge applicable to the goal.
