# Creative Quality Review

## Purpose

Use actually visible evidence to evaluate story, visual assets, video segments, continuity, sound, and final delivery against the goal, locate root causes, and recommend the smallest correction scope. Review does not invent success facts or equate “generation completed” with “watched, heard, and approved.”

## Skill reading composition

- For `outputKind=video_prompt_set`, read `director-core`, `video-direction`, and `quality-review` before creating the result. Before strict output, use this Skill to review the prompt itself for factual fidelity, executability, blocking, seams, sound, and the sole-output constraint.
- Prompt review can assess only the written design; it cannot claim that ungenerated video or audio has passed. The three Skills constrain one Worker's sole result and create no separate review field or second prompt.

## Evidence discipline

- Review only text, images, video, audio, structured facts, and exact versions actually supplied to the task.
- When images or video are unavailable, do not claim that identity, location, action, text, or visual quality passed. When audio is unavailable, do not claim that dialogue, synchronization, mix, or music passed listening review.
- Metadata may prove format, duration, state, or reference relationships, but cannot replace content review.
- Clearly distinguish what was verified, inferred from facts, requires human confirmation, or cannot be checked with current capability.
- Do not infer media content from chat history, thumbnail state, filename, success label, or a model's self-report.

## Compare with the goal first

- Restate the final deliverable and the user's locked content, runtime, aspect ratio, style, characters, sound, and assembly requirements.
- Separate the complete goal from intermediate artifacts. A successful asset does not prove a successful video, and one successful segment does not prove the whole work is complete.
- Report only issues that affect the goal. Do not replace explicit user choices with reviewer preference.

## Story and script review

- Are core characters, locations, relationships, constraints, tone, plot facts, and target runtime faithfully preserved?
- Do protagonist goal, motivation, resistance, choice, turns, and ending form understandable causality?
- Does each scene have place, action, dialogue or narration, emotional/information advance, and a natural connection to adjacent scenes?
- Is there repeated exposition, excessive dialogue, a scene that changes nothing, unsupported canon, knowledge acquired too early, or an object that returns after loss without cause?
- Can actual dialogue, action, reaction, pauses, and transitions fit the target runtime? Do not judge runtime from prose length or beat count alone.

## Continuity review

- Against stable canon, entry state, current events, and exit state, check identity, wardrobe, physical condition, location, relationships, knowledge state, prop ownership, world rules, and unresolved clues.
- Between chapters and segments, are completed changes inherited later, and are future changes prevented from appearing early?
- Do names and aliases resolve to the same entity, or has an approximate name created a duplicate character, location, or mistaken binding?
- Distinguish true contradiction from motivated change. A justified change in style, wardrobe, location, or emotion is not a continuity defect.

## Visual asset review

### Character

- Do identity, age impression, face structure, hair, body type, clothing, footwear, accessories, and era match the design?
- Is there accidental duplication, identity drift, missing anatomy, broken garment structure, irrelevant background, or narrative action?
- Does a non-human character preserve species and recognition anchors?

### Location

- Are location identity, era, material, architecture, key objects, and spatial relationships faithful?
- Are foreground/midground/background, spatial boundaries, stable anchors, and character placement areas clear?
- Is there an unwanted named person, random text, watermark, annotation, arrow, placeholder outline, or cropped critical structure?

### Prop and UI

- Do silhouette, construction, quantity, material, color, pattern, and wear match the prop design, with the object isolated and legible?
- Is critical UI understandable within the story world, with accurate natural text rather than gibberish?

### Style

- Do images and video share the approved overall visual language? Have asset-only lighting and composition incorrectly contaminated video design?
- Are candidates materially different while preserving identity and plot facts?

## Video review

- Do runtime, aspect ratio, full-frame presentation, and actual content match the deliverable?
- Is every referenced character, location, prop, or UI visibly the correct identity rather than merely named in the prompt?
- Does action complete from entry through ordered beats to exit, without repetition, truncation, or an impossible chain?
- Do scale and camera movement support narrative, without conflicting motion, purposeless drift, invented spatial connectors, or editing terminology rendered into the image?
- Are gaze, orientation, primary movement, performance, prop possession, and core set objects clear? When placement affects action, relationships, composition, or continuity, do the first frame and landing combine a stable physical anchor, frame region or depth, body orientation, and prop relationship?
- When a character changes position, are the starting point, path, and landing position visibly completed, with later shots inheriting the reached position through the same set anchor?
- Do major reveals, punchlines, reactions, and scale comparisons receive enough time while pacing remains causally understandable?
- Is every independently generated segment complete? Compare every outgoing final shot with the next incoming first shot: do they use visibly different scales rather than only a side/back view or slight camera-angle change, and are stable set anchors compatible when the character reappears?
- Did the model accidentally create a collage, grid, split screen, captions, title, watermark, or unwanted text overlay?

## Sound and music review

- Is dialogue verbatim, attributed to the correct speaker, stable in intrinsic voice, and synchronized with mouth and action?
- Does each speaking character with a bound voice cite the exact corresponding audio asset and `@AudioN`? Check for a missing, swapped, or cross-bound voice and for preview words incorrectly treated as story dialogue.
- Do steps, doors, impacts, cloth, machinery, and environmental sound correspond to visible events, with continuing sound sustained where needed?
- Is a key synchronized sound missing, or is there duplicated effect, unrelated narration, abnormal level, or abrupt sound cut?
- Does BGM support the true narrative emotion rather than mechanically mirror surface action, use silence where useful, and leave spectral room for dialogue?
- Is the score unified and continuous, changing with sections without unrelated style jumps, fixed looping, excessive drums, unsupported climaxes, or literal effects?
- Under an instrumental requirement, are vocals, lyrics, spoken word, environmental recordings, and foley absent?

## Locate the root cause

Classify the problem by its nearest real source:

- incorrect or missing input fact;
- weak asset identity or design;
- ambiguous, overloaded, conflicting, or temporally impossible prompt;
- incorrect reference ordering or mapping;
- mismatch between requirement and model capability;
- stochastic generation deviation;
- assembly, edit, or sound-layer problem;
- genuinely unverified content requiring a timestamp or user feedback.

Do not hide a reusable root cause behind one long story-specific prohibition. Extract the general issue, then propose the smallest correction for the current media.

## Minimum-scope correction

- Keep approved resources and segments unchanged. Modify only failed or genuinely deficient parts.
- Correct asset identity at the asset or reference level; correct action and continuity through the segment's entry, action beats, and exit; correct assembly problems through timeline or result selection only.
- When a candidate group partially fails, never regenerate already successful candidates.
- When the user reports a timestamp, inspect entry, exit, and continuing facts around that point rather than rebuilding the complete work.
- After correction, review the affected range and adjacent seam using the new result so a local fix does not create another contradiction.

## Reporting the review

- Give a clear conclusion against the user's goal first, followed by verified facts, concrete issues, impact, and recommended correction.
- Every issue should be locatable, explainable, and actionable, ideally identifying a segment, shot, timestamp, character, or asset.
- Do not exaggerate review capability or turn “no issue observed” into “100% correct.”
- When input is insufficient, state which media, version, or user feedback is required instead of inventing a conclusion.

## Self-check

- Is every conclusion based on evidence actually supplied?
- Did the review cover final goal, content quality, and cross-segment continuity rather than success state alone?
- Did it distinguish motivated story change from unsupported drift?
- Does every issue map to a real root cause and minimum correction scope?
- Are all successful, approved, and unaffected resources preserved?
- Is unavailable visual or audio content honestly marked unverified?
- Does every `referenceKeys` label resolve to the exact image or audio revision actually used by the prompt, with no second voice-reference field?

## Boundary

This Skill provides creative-review methods. Task lifecycle, error codes, retry authorization, resource revisions, persistent state, media-decoding capability, and actual correction execution belong to the primary Agent and system tools.
