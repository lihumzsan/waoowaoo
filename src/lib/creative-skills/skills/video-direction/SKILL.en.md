# Video Direction and Generation Design

## Purpose

Turn approved story facts, shot intent, character/location/prop references, and sound requirements into a complete design that can be sent directly to a video-generation model. Priorities are unambiguous references, executable timing, action with entry and landing states, internal continuity, credible seams between independent generations, and correct use of native synchronized audio.

## Skill reading composition

- For `outputKind=video_prompt_set`, actually read `director-core`, `video-direction`, and `quality-review` before creating the result. Their applicability is declared in the catalog summaries; do not skip either companion because one Skill appears sufficient by itself.
- Within the same generic Worker run, complete directing judgment, write each segment's sole final prompt, then apply the quality review. Do not split the three knowledge sources into serial Subagents, parallel process fields, or multiple outputs.

## When to design video directly

- Video-design input must include a finalized Style Bible with exact provenance. It governs the complete work's visual expression. If it is missing, do not return an executable design; the caller boundary must fail explicitly instead of improvising another style.
- A single short shot can become a final video prompt directly from the user's goal; it does not require a complete screenplay, global continuity Bible, or professional timeline, but it still requires the finalized Style Bible with exact provenance.
- Multi-shot, multi-segment, or assembled work should first obtain enough shot order, duration, and continuity facts, then generate independently valid video segments.
- Design only character, location, prop, or UI references that the final result will actually use. Irrelevant inputs dilute identity and location priority.

## Reference media

- Use an explicitly ordered reference manifest for media. Number images and audios independently, and refer to them as “the character in image 1 (@Image1)” or “the locked voice in audio 1 (@Audio1).” Do not make the model guess from asset names, filenames, internal IDs, or chat nicknames.
- `referenceKeys` contains only the exact source-material labels actually used by this Segment, in provider-media order. Images map to `@ImageN` within the image sequence and audios map to `@AudioN` within the audio sequence; never create a second field such as `voiceReferenceKeys`.
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

## Blocking and first/last frames

- When placement affects action legibility, character relationships, composition, or continuity, state the first visible arrangement and the shot's landing position in the final prompt. Use the smallest sufficient combination of stable physical anchor, frame region or foreground/midground/background depth, body orientation, and relationship to a prop or another character. Prefer natural language such as “at the left end of the chart table in the left third of frame,” not pixel coordinates.
- When a character changes position, make the starting point, movement path, and landing position continuously visible. After arrival, begin later relevant shots from that result and reuse the same set anchor, region, orientation, or prop relationship.
- In multi-character shots, state distance, depth order, and set anchors only when the narrative needs them. Preserve clear screen direction when action direction or an eyeline relationship depends on the spatial axis.
- An empty establishing shot, isolated prop insert, or unambiguous detail shot need not mechanically include character blocking, but still state which subject, scale, and spatial layers form its first frame.
- Express these as positive visible facts for the model to generate, not as a long defensive list of negations.

## Shot changes and conditional transitions

- First decide whether a transition is genuinely useful. Most boundaries should connect naturally: do not add a decorative transition for continuous action, an ordinary angle change, or events in the same time and place; simply continue the action or enter the next scale.
- For an ordinary change of place or time, a light phrase such as “cut to the location in image N” is enough, followed immediately by the new shot's already-established framing, character state, and action. There is no need to label it a “hard cut.” When two scenes naturally share composition, action, color, or sound, a direct change can let that visible relationship carry the connection.
- Choose one primary creative transition only when a time/place jump, time compression, emotional turn, thematic metaphor, or visual spectacle gives it real value. Do not use one at every scene boundary or repeatedly inside continuous action in one scene.
- **No dissolves or fades**: no shot boundary may use a dissolve, cross-dissolve, fade-in, fade-out, fade to black, fade from black, or transparent overlap between outgoing and incoming images. Every final prompt containing two or more Shots must explicitly state: `No dissolves, cross-dissolves, fade-ins, or fade-outs between shots; outgoing and incoming images must never overlap transparently.` Omitting a request for a dissolve does not count as prohibiting one.
- **Dark/black bridge**: this is not a fade to black or fade in from black. The outgoing shot must reach low light through a real visible event, such as the subject entering an unlit space or a practical source actually switching off, then change cleanly only after the image is dark. The incoming low-light scene is already fully established from its first frame and is revealed by a real light inside that scene; the two scenes must never appear together or blend transparently. Do not insert an arbitrary standalone black card.
- **Montage transition**: use several short, individually legible images to compress time, show progress, or establish rhythm. Unite them around one narrative purpose, action rhythm, or visual motif, then give the montage a clear landing instead of fragmenting the whole film.
- **Metaphorical transition**: map a shape, color, motion direction, light source, or sound motif across shots—for example, a flashlight beam becoming a lighthouse beam. Each shot must remain independently clear; never write only “metaphorical transition” and ask the model to guess.
- **Creative transition**: an existing reflection, bloom, smoke, shadow, natural foreground, color field, or moving story element may create a physical reveal within one shot or lead to a clean change at an explicit boundary. Describe exactly what is last visible in the outgoing shot, what is first visible in the incoming shot, and how they connect. Never blend two scenes through opacity, and do not invent a door, wall, corridor, or lens-covering object solely to create a transition.
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
- Before output, inspect every adjacent independent-segment pair in final order. The outgoing final shot and incoming first shot must use visibly different scales. A side/back view or slight camera-angle change cannot replace a scale change, and different scale labels cannot disguise nearly identical subject size and composition.
- At a same-location, same-character seam, also avoid repeating nearly identical dominant background composition. Choose a motivated and clearly different scale, an informative prop or action insert, an environmental view, or a camera position that clearly changes the subject-to-space ratio. When the character next becomes an identifiable on-screen subject, inherit placement through the same stable set anchor.
- Do not hide seams with unmotivated black frames, invented walls, or objects designed only to cover the frame. When the story already provides motivated darkness, light, reflection, or a visual motif, the conditional transition rules above may be used.
- Adjacent segments preserve compatible identity, wardrobe, prop state, movement energy, environmental color, and sound atmosphere while remaining natural independent shots.
- When one final file is required, preserve explicit order, true duration, and composable audio-visual boundaries. Continue assembly only when the caller actually provides a video-combination capability; otherwise tell the user plainly. A generated segment cannot pretend final assembly has already happened.

## Dialogue, sound, and native audio

- Native audio is enabled by default for video generation. Every final prompt should include the dialogue, synchronized effects, and ambience genuinely needed by the visible action; when there is no dialogue, still design sound that fits the action and space instead of outputting a separate audio switch or intent field.
- Keep dialogue verbatim and identify the speaker and stable intrinsic voice. Never replace dialogue with narration.
- When a speaking character has an exact bound voice, include that audio in the reference manifest and cite both the character image and its `@AudioN` in the speaking instruction. A bound voice defines only that character's intrinsic timbre and voice identity. Ignore words spoken in the preview audio and never repeat them as story dialogue; the only spoken content comes from `{spoken line}`.
- Use this fixed structure: first write `Voice reference manifest: audio 1 (@Audio1) — the locked voice for “Character”; use only its intrinsic timbre and voice identity, and ignore the preview words.` Then write within the time range: `Character preserves identity from image N (@ImageN), uses audio 1 (@Audio1), and says with … delivery: {verbatim line}.` Give different speaking characters their own bound audio numbers; never cross-bind voices or share an unconfirmed voice.
- Use `{spoken line}` for exact dialogue and `<sound description>` for short synchronized sounds. Add relevant steps, cloth, doors, impacts, machinery, ambience, or object sound to action shots.
- Express continued sound as a fact such as “the alarm continues” or “the undersea rumble intensifies,” not through J-cut or L-cut terminology.
- **Sound relationship choice:** Before writing the final prompt for every Segment, actively decide whether it uses only sound synchronized to the current image, sound that leads its visual source, sound that carries across a Shot boundary, offscreen dialogue that reveals a character before the image does, or no special sound relationship.
  - For synchronized sound only, place steps, doors, impacts, cloth, machinery, and ambience in the corresponding Shot; add no Segment cue.
  - For a sound lead, state when it starts, which later Shot reveals its visual source, and whether it must remain offscreen until that reveal.
  - For a carrying sound, state which Shot boundary it crosses and when it intensifies, fades, or stops so the same event is not retriggered in every Shot.
  - For an offscreen-dialogue reveal, keep the exact spoken line owned only by its speaker's source Shot; the leading interval only refers to that line and intrinsic voice, without rewriting it.
- The sound-relationship judgment is required, but a special cue is not. Add a time range and source Shot to the sound timeline of the same generated Segment only when a lead, carry, or offscreen reveal has narrative value; otherwise omit it. Write each Shot's synchronized sound directly as `<sound description>` inside the same final prompt.
- Horror, giant-creature, and climax scenes may use distinctive low frequency, structural vibration, abnormal creature sound, or spatial reverberation when it serves the visible event.
- Native synchronized video sound and independent BGM have separate responsibilities. Do not needlessly cover or duplicate generated dialogue, sync sound, or ambience, and do not treat a music generator as a voice or effects source.

## Excellent complete prompt examples

Each example below is one complete prompt that can be sent directly to a video model, not a field template. Adapt freely to the real segment; never copy the subject, duration, or shot count mechanically.

### Example one: one scene without a creative transition

> 15 seconds, 16:9, grounded suspense cinema. Preserve the engineer's face, short hair, dark-blue rain jacket, and restrained presence from image 1; remain in the cold-cyan coastal sonar room from image 2. 0–4s, wide view slowly pushing toward the console: she stands back to camera at the controls as rain crosses the window, <rain on glass, equipment hum>. 4–10s, stable medium close from her right: an anomalous echo stops her hand; she looks to the circular signal and says in her low, slightly rough voice: {It isn't a whale. It's answering us.} <short sonar pulse, deeper return>. 10–15s, insert of the expanding echo, then face close-up; red warning light activates as she grips the desk and looks toward the dark sea. Keep action single, performance restrained, the exact line lip-synced, and wardrobe, instruments, and rain continuous. No captions or additional people.

> No dissolves, cross-dissolves, fade-ins, or fade-outs between shots; outgoing and incoming images must never overlap transparently.

### Example two: a motivated dark and metaphorical transition

> 15 seconds, 2.39:1, poetic science fiction in deep blue and silver-grey. Preserve the explorer, silver suit, and hand light from image 1. 0–6s, stable medium follow in the undersea corridor from image 2: her beam crosses corroded walls and mist; she stops at an unlit hatch, <boots in water, metal drone, breathing>. 6–8s, she enters the unlit chamber; her real light disappears behind the frame and the corridor reaches near-black, then changes cleanly only after darkness. 8–12s, the new first frame is already the near-black storm sea from image 3. A lighthouse beam sweeps across it in the prior beam's direction and speed, <metal drone becoming wind and surf>. The locations remain separate. 12–15s, a distant pull-back reveals a giant still silhouette in the clouds, <remote low call>. Use this one motivated bridge only; keep the explorer in the station and preserve beam direction and sound progression. No dissolves, cross-dissolves, fade-ins, or fade-outs between shots; outgoing and incoming images must never overlap transparently.

### Example three: blocking and seam design across two independent segments

These are two separate, self-sufficient prompts. The seam changes from medium-wide to extreme close-up; the same chart-table anchor restores placement when the character returns.

> 15 seconds, 2.39:1, grounded maritime suspense in the storm-lit lighthouse room from image 2. Preserve the keeper and wardrobe from image 1. 0–7s, medium close: he stands at the chart table's left end in the left third, body toward the storm window, right hand on the centered brass radio; an anomalous signal makes him listen, <wind on glass, static, timber strain>. 7–15s, cut to medium-wide: table across the lower frame, keeper at the same left end, radio center, window behind. In his low voice: {This is not a distress signal. It is broadcasting our coordinates.} He looks to the window, hand still on the dial. Land on the three-layer arrangement, <lip-synced line, static stopping, distant foghorn>. No dissolves, cross-dissolves, fade-ins, or fade-outs between shots; outgoing and incoming images must never overlap transparently.

> 15 seconds, 2.39:1, the same grounded storm-lit lighthouse room; preserve the keeper from image 1 and the window, chart table, and radio from image 2. Entry: keeper at the table's left end, right hand on the centered radio dial. 0–4s, extreme close-up: frequency needle, damp dial, and gloved hand fill frame; the needle stops at a red mark, <fine static, metallic click>. 4–10s, cut to medium close: he becomes the identifiable subject at the same table end in the left third, body toward the window, hand moving from dial to table edge; lightning reveals his profile. 10–15s, push into face close-up as wet glass reflects an approaching white beam, <lower wind, distant foghorn>. He stays silent and alert. No dissolves, cross-dissolves, fade-ins, or fade-outs between shots; outgoing and incoming images must never overlap transparently.

## Final segment review

- Does every image and audio reference number point exactly to its intended character, location, prop, UI, or locked character voice?
- Can every shot finish within its allocated time, with a clear entry, action order, and landing state?
- Was transition necessity judged first? Are ordinary connections simple, and does every creative transition have a clear motivation, visible endpoint and starting state without deforming the subject?
- Does every multi-Shot prompt explicitly prohibit dissolves, cross-dissolves, fade-ins, and fade-outs, with no transparent overlap between outgoing and incoming images?
- Are identity, wardrobe, physical state, props, movement, emotion, environment, and sound continuous where required?
- Is dialogue verbatim with a clear speaker, and is sound synchronized, leading, or carrying only when useful, without redundant external layers?
- Does every speaking character with a bound voice cite the correct `@AudioN`, with no preview words leaking into `{spoken line}`?
- Was every adjacent independent-segment pair checked in order, with a genuinely visible scale change between the outgoing final shot and incoming first shot rather than only a new angle or renamed near-identical composition?
- Do first and last frames that require placement use stable physical anchors, frame region or depth, body orientation, and prop relationships? Does every position change have a visible starting point, path, and landing position?
- Does the prompt include only information needed by this video, without irrelevant references or internal explanation?

## Boundary

This Skill provides video creative and final-prompt methods. Exact Resource revision IDs, model capability validation, reference limits, provider parameters, media submission, billing, and deterministic execution templates belong to the caller and execution layer.
