# Video Direction and Generation Design

## Purpose

Turn approved story facts, shot intent, character/location/prop references, and sound requirements into a complete design that can be sent directly to a video-generation model. Priorities are unambiguous references, executable timing, action with entry and landing states, internal continuity, credible seams between independent generations, and correct use of native synchronized audio.

## When to design video directly

- A single short shot can become a final video prompt directly from the user's goal; it does not require a complete script, Bible, or professional timeline.
- Multi-shot, multi-segment, or assembled work should first obtain enough shot order, duration, and continuity facts, then generate independently valid video segments.
- Design only character, location, prop, or UI references that the final result will actually use. Irrelevant inputs dilute identity and location priority.

## Reference media

- Use an explicitly ordered reference manifest and refer to it in the final prompt as “the character in image 1,” “the location in image 2,” or “the prop in image 3.” Do not make the model guess from asset names, filenames, internal IDs, or chat nicknames.
- Order references by narrative importance and first use. Identity-critical characters normally come first, then key props or required UI, then locations in order of appearance; the current story's actual emphasis outranks a fixed template.
- Give each image one clear primary responsibility. Supply only media used in the current segment and respect the target model's real reference limit; never silently truncate, substitute, or reorder user-locked references.
- Preserve approved identity, wardrobe, silhouette, environment structure, and prop design, while preventing incidental source pose, lighting, noise, or composition from overriding the current video requirements.
- Phone messages, screen cards, or critical UI that must appear within the video may be image references rendered diegetically. Design a post-production overlay only when the user explicitly requests one.

## Final video prompt

- Use the language of the user's content and dialogue.
- Begin concisely with total duration, aspect ratio, subject, and overall visual style; then describe shots in chronological order; end with only continuity and quality requirements directly relevant to this video.
- Organize each shot with a clear time range, shot scale, one primary camera move, image references, visible location, character or prop, action and performance, verbatim dialogue, and synchronized sound. Always write exact dialogue as `{spoken line}` and short synchronized sound as `<sound description>` instead of blending both ambiguously into prose.
- Describe the complete image and sound the model must generate. Do not explain workflow, system rules, testing reasons, internal data structures, or project state.
- Be sufficient but concise. Include only current-shot facts, not the complete project archive, every guideline, or an irrelevant prohibition list.
- Produce one continuous full-frame video, not a collage, grid, split screen, contact sheet, caption, title, or text overlay unless explicitly requested and supported.

## Shots and location changes

- When a new place appears, use a light marker such as “cut to the location in image N,” then immediately describe the new shot's established framing and action state.
- Do not describe hard cuts, jump cuts, soft cuts, dissolves, match edits, action peaks, J-cuts, L-cuts, occlusion cuts, wipes, objects crossing the lens, or objects covering/filling the frame in detail. Generative models often render those terms as incorrect visible content.
- Do not ask the model to invent corridors, stairs, foyers, or other connecting spaces between unrelated location references.
- Cut directly when the intermediate process is unimportant. Reserve real action shots for walking, opening, running, riding, or arriving only when that process is necessary to understand the story.
- After a location change, begin from the already established new state rather than forcing separate environments into one interpolated motion path.

## Action design

- Fit a small number of sequential action beats into the duration, each with a visible endpoint. A short shot normally carries one to three core actions.
- Do not stretch one tiny action across a long shot, which invites repeated performance, or overload a short shot with an impossible action chain.
- State the visible entry condition and achieved exit condition. Once a character is standing, holding an object, seated, turned, or arrived, the next shot begins from that result instead of replaying it.
- When direction or gaze matters, make it visible: “back to camera, facing the mural,” “turns sideways toward the end of the corridor,” or “looks up toward the sea creature,” not merely “observes” or “sees.”
- In high-risk multi-character shots, a concise instruction that each character appears once may help. Avoid stacks of defensive language such as “only once, never return, never cross again”; solve ambiguity with clear action beats first.

## Continuity

- Carry only facts important to the current segment: identity and wardrobe, physical state, movement speed and main path, emotional intensity, prop ownership, core set objects, time and environmental color, and continuing sound.
- Express continuity as visible and audible facts, not editing meta-language.
- Explicitly keep an important prop, altar, sedan, vehicle, or other core set object present when later shots require it. Do not add objects absent from approved references or duplicate core structures without cause.
- Shots inside one generation share necessary spatial and action continuity. Separate generations preserve compatible states without pretending to be one seamless take.
- Every segment uses an accurate entry state and ends at an exit state later work can inherit.

## Rhythm, atmosphere, and emotional release

- According to genre, use a narratively useful short environmental shot or ambient action to establish place, scale, and mood. Do not mechanically add one to every scene.
- Establishing shots, reactions, and prop inserts appear only when they carry information, suspense, comic timing, gaze direction, or atmospheric change.
- Major reveals and spectacle need more time than ordinary action, often using “sign or detail — full reveal — reaction or scale comparison” for emotional release.
- Comedy and hook-driven short video protect the opening hook, reaction pause, and punchline landing. Narrative shorts protect causal comprehension rather than deleting essential action for rapid cutting.

## Long video and independent segment seams

- When the work exceeds one generation's duration, split it into independently complete video segments. Each segment has a clear local dramatic and emotional task; never divide one unfinished action across two generations.
- Use a visible scale or angle difference between the last shot of one segment and the first of the next, reducing the chance that independent blocking changes read as a visual jump.
- Do not hide seams with black frames, walls, wipes, or objects covering the frame.
- Adjacent segments preserve compatible identity, wardrobe, prop state, movement energy, environmental color, and sound atmosphere while remaining natural independent shots.
- When one final file is required, preserve explicit order, true duration, and composable audio-visual boundaries. Continue assembly only when the caller actually provides a video-combination capability; otherwise tell the user plainly. A generated segment cannot pretend final assembly has already happened.

## Dialogue, sound, and native audio

- When the model supports native audio and the work needs dialogue or sync sound, ask the video model to generate synchronized audio.
- Keep dialogue verbatim and identify the speaker and stable intrinsic voice. Never replace dialogue with narration.
- Use `{spoken line}` for exact dialogue and `<sound description>` for short synchronized sounds. Add relevant steps, cloth, doors, impacts, machinery, ambience, or object sound to action shots.
- Express continued sound as a fact such as “the alarm continues” or “the undersea rumble intensifies,” not through J-cut or L-cut terminology.
- Horror, giant-creature, and climax scenes may use distinctive low frequency, structural vibration, abnormal creature sound, or spatial reverberation when it serves the visible event.
- Native synchronized video sound and independent BGM have separate responsibilities. Do not needlessly cover or duplicate generated dialogue, sync sound, or ambience, and do not treat a music generator as a voice or effects source.

## Final segment review

- Does every reference number point exactly to its intended character, location, prop, or UI?
- Can every shot finish within its allocated time, with a clear entry, action order, and landing state?
- Do location changes begin directly from the new state without invented connectors or rendered editing jargon?
- Are identity, wardrobe, physical state, props, movement, emotion, environment, and sound continuous where required?
- Is dialogue verbatim with a clear speaker, and is sound synchronized without redundant external layers?
- Is every independent segment complete, with credible scale/angle differences at seams?
- Does the prompt include only information needed by this video, without irrelevant references or internal explanation?

## Boundary

This Skill provides video creative and final-prompt methods. Resource IDs, revisions, fingerprints, model capability validation, reference limits, provider parameters, media submission, billing, and deterministic execution templates belong to the caller and execution layer.
