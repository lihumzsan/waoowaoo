# Director and Production Timeline Core

## Purpose

Turn established story facts into an executable production timeline: why each shot exists, what happens on screen, how characters perform, what dialogue and synchronized sound occur, which consecutive shots can be generated together, and which shot scale and camera motion each shot uses.

This is one unified layer of directing knowledge. A caller may request the complete timeline or only one scope. When working on one scope, never rewrite already approved parts outside it.

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

## Rhythm and emotional release

- Use the opening seconds to establish the hook, space, and main pressure according to genre. Fast pacing must not remove actions needed to understand causality.
- Keep ordinary action concise. Major revelations, spectacle, and key emotion need sufficient time for “signal or detail — full reveal — reaction or scale comparison.”
- Comedy values reaction pauses and punchline landing; suspense controls information and gaze order; drama protects the causality of choice; action protects readable movement and endpoints.
- Shots form an attention flow, action flow, and emotional curve instead of functioning as isolated attractive images.

## Generation segmentation

- Group sequential shots that can share continuity of action, performance, space, emotion, props, and synchronized sound.
- Each segment completely and sequentially covers its shots and respects the current model's single-generation duration limit. Never omit, reorder, or force discontinuous shots together.
- Do not split one unfinished action across independent generations. Every independent segment has an established entry state, local task, and ending point.
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

- For editorial structure only: decide purpose, duration, scene, action, performance, dialogue, synchronized sound, and generation grouping. Do not add scale, camera position, composition, lighting, movement, or final generation prompts.
- For shot execution only: cover the supplied shots in their original order and add only scale, primary movement, and stability. Do not rewrite story, action, performance, dialogue, or synchronized sound.
- For a unified Production Timeline: clearly separate editorial, execution, and later result selection under the same shot, without allowing result state to rewrite approved creative facts.

## Review

- Does the plan use only established facts and approved assets while preserving dialogue verbatim?
- Does every shot have a clear narrative function, visible action, and credible duration?
- Is performance free of blocking, coordinates, and camera staging?
- Does sync sound contain only synchronized short sounds, without BGM or a continuous ambience plan?
- Are generation segments sequential, complete, within capability limits, and free of actions split across generations?
- Do scale and movement serve rather than overwrite the editorial plan?
- Are entry and exit states, props, character state, and emotion continuous between adjacent shots?

## Boundary

This Skill provides unified directing methods. Shot fields, allowed enums, hard duration limits, system identities, strict output schemas, and final video prompts are defined by the caller and execution layer.
