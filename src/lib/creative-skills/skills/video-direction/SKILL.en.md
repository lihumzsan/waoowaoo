# Video Direction and Generation Design

## Purpose

Turn approved story facts, shot intent, character/location/prop references, and sound requirements into a complete design that can be sent directly to a video-generation model. Priorities are unambiguous references, executable timing, action with entry and landing states, internal continuity, credible seams between independent generations, and correct use of native synchronized audio.

## When to design video directly

- Video-design input must include a finalized Style Bible with exact provenance. It governs the complete work's visual expression. If it is missing, do not return an executable design; the caller boundary must fail explicitly instead of improvising another style.
- A single short shot can become a final video prompt directly from the user's goal; it does not require a complete screenplay, global continuity Bible, or professional timeline, but it still requires the finalized Style Bible with exact provenance.
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
- Complete directing judgment internally, then put all professional knowledge needed by the current generation segment into one final video prompt. Shot purpose, entry and exit state, performance, action, scale, camera motion, continuity, verbatim dialogue, synchronized sound, and any applicable transition are not parallel process outputs; when relevant, each becomes an executable visual or audio instruction in the final prompt.
- Begin concisely with total duration, aspect ratio, subject, and overall visual style; then describe shots in chronological order; end with only continuity and quality requirements directly relevant to this video.
- Organize each shot with a clear time range, shot scale, one primary camera move, image references, visible location, character or prop, action and performance, verbatim dialogue, and synchronized sound. Always write exact dialogue as `{spoken line}` and short synchronized sound as `<sound description>` instead of blending both ambiguously into prose.
- Describe the complete image and sound the model must generate. Do not explain workflow, system rules, testing reasons, internal data structures, or project state.
- Be sufficient but concise. Include only current-shot facts, not the complete project archive, every guideline, or an irrelevant prohibition list.
- Produce one continuous full-frame video, not a collage, grid, split screen, contact sheet, caption, title, or text overlay unless explicitly requested and supported.

## Shot changes and conditional transitions

- First decide whether a transition is genuinely useful. Most boundaries should connect naturally: do not add a decorative transition for continuous action, an ordinary angle change, or events in the same time and place; simply continue the action or enter the next scale.
- For an ordinary change of place or time, a light phrase such as “cut to the location in image N” is enough, followed immediately by the new shot's already-established framing, character state, and action. There is no need to label it a “hard cut.” When two scenes naturally share composition, action, color, or sound, a direct change can let that visible relationship carry the connection.
- Choose one primary creative transition only when a time/place jump, time compression, emotional turn, thematic metaphor, or visual spectacle gives it real value. Do not use one at every scene boundary or repeatedly inside continuous action in one scene.
- **Dark/black bridge**: the outgoing shot needs a motivated low-light endpoint, such as entering an unlit space, a practical light going out, or exposure naturally falling almost to black. Begin the incoming shot at matching low light, then let its own source reveal the new scene. Do not insert an arbitrary standalone black card.
- **Montage transition**: use several short, individually legible images to compress time, show progress, or establish rhythm. Unite them around one narrative purpose, action rhythm, or visual motif, then give the montage a clear landing instead of fragmenting the whole film.
- **Metaphorical transition**: map a shape, color, motion direction, light source, or sound motif across shots—for example, a flashlight beam becoming a lighthouse beam. Each shot must remain independently clear; never write only “metaphorical transition” and ask the model to guess.
- **Creative transition**: an existing reflection, bloom, smoke, shadow, natural foreground, color field, or moving story element may reveal the next shot, but describe exactly what is last visible in the outgoing shot, what is first visible in the incoming shot, and how they connect. Do not invent a door, wall, corridor, or lens-covering object solely to create a transition.
- Sound may continue across a shot change to unify emotion or introduce the next scene. Write audible facts such as “the alarm continues into the next shot” or “ocean waves begin before the new image,” not J-cut or L-cut terminology.
- A short generation segment normally uses at most one primary transition logic. In a longer sequence, repeat one motif only at a few important boundaries. Drop a creative transition when it would obscure key performance, deform the subject, or introduce identity ambiguity.
- Across independently generated segments, coordinate only the visible endpoint of the earlier clip and visible starting state of the next. Never claim that two model calls can interpolate seamlessly.

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

- `targetDurationSeconds` is the total duration of the complete work or current Chapter, never one segment's duration. This Worker owns segment count and per-segment duration from directing needs and `productionContext.video`; ignore caller prose that prescribes “six segments,” “ten seconds each,” or another split.
- Use only `allowedSegmentDurationsSeconds`, and use the authoritative `aspectRatio` in the final prompt. Prefer the maximum allowed duration and fewer generations when content is continuous. When the current ceiling is 15 seconds, do not split material that naturally fits one 15-second generation into several shorter clips.
- A shorter segment needs a concrete reason: a time/place/state break, an action that needs its own landing, or an exact-total remainder combination. Every segment duration must sum exactly to the total target.
- When the work exceeds one generation's duration, split it into independently complete video segments. Each segment has a clear local dramatic and emotional task; never divide one unfinished action across two generations.
- Use a visible scale or angle difference between the last shot of one segment and the first of the next, reducing the chance that independent blocking changes read as a visual jump.
- Do not hide seams with unmotivated black frames, invented walls, or objects designed only to cover the frame. When the story already provides motivated darkness, light, reflection, or a visual motif, the conditional transition rules above may be used.
- Adjacent segments preserve compatible identity, wardrobe, prop state, movement energy, environmental color, and sound atmosphere while remaining natural independent shots.
- When one final file is required, preserve explicit order, true duration, and composable audio-visual boundaries. Continue assembly only when the caller actually provides a video-combination capability; otherwise tell the user plainly. A generated segment cannot pretend final assembly has already happened.

## Dialogue, sound, and native audio

- Native audio is enabled by default for video generation. Every final prompt should include the dialogue, synchronized effects, and ambience genuinely needed by the visible action; when there is no dialogue, still design sound that fits the action and space instead of outputting a separate audio switch or intent field.
- Keep dialogue verbatim and identify the speaker and stable intrinsic voice. Never replace dialogue with narration.
- Use `{spoken line}` for exact dialogue and `<sound description>` for short synchronized sounds. Add relevant steps, cloth, doors, impacts, machinery, ambience, or object sound to action shots.
- Express continued sound as a fact such as “the alarm continues” or “the undersea rumble intensifies,” not through J-cut or L-cut terminology.
- Horror, giant-creature, and climax scenes may use distinctive low frequency, structural vibration, abnormal creature sound, or spatial reverberation when it serves the visible event.
- Native synchronized video sound and independent BGM have separate responsibilities. Do not needlessly cover or duplicate generated dialogue, sync sound, or ambience, and do not treat a music generator as a voice or effects source.

## Excellent complete prompt examples

Each example below is one complete prompt that can be sent directly to a video model, not a field template. Adapt freely to the real segment; never copy the subject, duration, or shot count mechanically.

### Example one: one scene without a creative transition

> 15 seconds, 16:9, grounded suspense cinema. Preserve the face, short hair, dark-blue rain jacket, and tired but controlled presence of the female engineer in image 1. Remain throughout in the coastal sonar control room from image 2, with consistent cold cyan instrument light and the same storm outside. 0–4s, wide room view, the camera slowly pushes toward the console while the engineer stands with her back to camera and checks a continuously pulsing sonar trace; rain streams down the windows, <heavy rain striking glass, low equipment hum>. 4–10s, a stable medium close view advances from her right. An anomalous echo makes her stop her hand and look up toward a huge circular signal at the center of the display; her breathing becomes shallow. In her stable low, clear, slightly rough voice she says: {It isn't a whale. It's answering us.} <one short sonar pulse, followed by a much deeper return>. 10–15s, show an insert of the expanding circular echo, then return to a close view of her face. A red warning light activates; she does not step back, only tightens one hand around the desk edge and looks toward the black ocean outside in the final second. Each action happens once, performance stays restrained and natural, lip motion matches the exact line, and instruments, wardrobe, and rain direction remain continuous. No captions, titles, or additional people.

### Example two: a time-compression montage transition

> 15 seconds, 9:16, warm and resilient urban documentary advertising, fine film grain and high-contrast morning light. Preserve the body number and weathered surface of the vintage green tram in image 1 and the identity, orange workwear, and white helmet of the young maintenance worker in image 2. Build one clearly paced repair montage around the idea that “the city regains its heartbeat.” 0–3s, wide street before dawn, the stopped tram rests on wet rails as the worker approaches with a toolbox, <distant wind, tools touching lightly>. 3–6s, three brief and legible action images advance on a metallic beat: a gloved hand tightens a terminal; welding light reveals the worker's focused eyes; an old wheel slowly turns. Keep one subject and one completed action in each image, <wrench click, welding crackle, wheel friction>. 6–10s, cabin lights illuminate one by one from front to back while blue-grey dawn grows warmer. Connect adjacent images through the repeating circular lights and impact rhythm without abstract graphics or collage. 10–15s, cut to established bright morning; a low tracking view follows the tram gliding around a corner while the worker stands roadside, removes his gloves, and smiles. Land on <a clear tram bell, rolling rails, the murmur of a waking street>. Use montage only for the middle time compression and finish on one stable complete shot. No narration, captions, brand text, or duplicate tram.

### Example three: a motivated dark and metaphorical transition

> 15 seconds, 2.39:1, poetic science-fiction cinema in desaturated deep blue and silver-grey, humid air and physically believable volumetric light. Preserve the face, silver protective suit, and cylindrical hand light of the female explorer in image 1. 0–6s, in the abandoned undersea-station corridor from image 2, a stable medium view follows her forward. Her beam moves over corroded walls and suspended mist; she stops beside an unlit hatch and turns slightly to listen, <boots through shallow water, distant metal drone, controlled breathing>. 6–8s, she opens the hatch and enters a space with no illumination. The hand light naturally disappears behind the frame and exposure falls with the real environment to almost black while the metal drone continues; do not insert text or a standalone black card. 8–12s, begin the next shot at the same near-black level. One horizontal white beam appears first and gradually reveals itself as the lighthouse beam over the storm sea in image 3. Match the direction and speed of the earlier hand light to the lighthouse beam as a clear visual metaphor, while the sea and lighthouse are already established from the first moment of the new shot and the two locations never blend or morph, <the metal drone naturally becomes ocean wind and deep surf>. 12–15s, the distant camera slowly pulls back; the lighthouse looks small against giant waves, and its beam crosses again to reveal an enormous motionless silhouette inside the clouds, <one remote low-frequency call>. Use this transition only once between 6–8s and 8–12s. The explorer appears only in the undersea station; do not duplicate her in the lighthouse shot. Preserve clear sound, beam direction, and emotional escalation. No captions or extra objects.

## Final segment review

- Does every reference number point exactly to its intended character, location, prop, or UI?
- Can every shot finish within its allocated time, with a clear entry, action order, and landing state?
- Was transition necessity judged first? Are ordinary connections simple, and does every creative transition have a clear motivation, visible endpoint and starting state without deforming the subject?
- Are identity, wardrobe, physical state, props, movement, emotion, environment, and sound continuous where required?
- Is dialogue verbatim with a clear speaker, and is sound synchronized without redundant external layers?
- Is every independent segment complete, with credible scale/angle differences at seams?
- Does the prompt include only information needed by this video, without irrelevant references or internal explanation?

## Boundary

This Skill provides video creative and final-prompt methods. Resource IDs, revisions, fingerprints, model capability validation, reference limits, provider parameters, media submission, billing, and deterministic execution templates belong to the caller and execution layer.
