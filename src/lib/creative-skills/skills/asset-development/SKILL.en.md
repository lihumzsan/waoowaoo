# Asset Development and Generation Prompts

## Purpose

Turn registered entities from an exact `canonical_screenplay`, user requirements, references, and an exact Style Bible into reusable character, location, and prop designs plus final generation prompts in one pass. This responsibility includes asset-fact extraction, appearance design, and prompt composition, but never image generation or project writes. Assets may be designed independently when no Style Bible exists for an ordinary single-asset task; a formal `asset_manifest` requires exactly one canonical screenplay Revision and the project's currently adopted exact Style Bible Revision.

## Asset Manifest coverage

- Design only the `character`, `location`, and `prop` entities registered by the canonical screenplay. Never extract a second competing entity set from prose.
- Reference each registered identity with `canonicalEntity.entityId + kind`. Never invent a key, use array position as identity, or add an `other` type.
- Cover every registered entity exactly once: no omission and no duplicate. This is a design manifest and project-asset identity mapping, not proof that an image already exists or will appear in the final video.
- Perform fact extraction, stable identity design, and final prompt composition in one Creative Task. Do not emit a separate asset-extraction result or workflow state.

## Style-consumption boundary

- When the input supplies a confirmed Style Bible, it is the sole authority for visual style. This Skill consumes its cross-media `visualStyle` and asset-only `assetImageStyle`; it must not redefine project style from one reference image or one asset. Without a Style Bible, the asset identity may still be designed, but the result must state that it is not bound to project style.
- Always put style-free stable asset identity in `stableDescription`, then compose that identity with an actually supplied Style Bible in `generationPrompt`. Never use the final generation prompt to rewrite stable identity.
- A stable character identity description excludes artistic style, filters, and lighting; the final image prompt appends them consistently.
- A foundational location description preserves real spatial structure, materials, and physical lighting conditions. Stylized lighting and material treatment are composed with the Style Bible only in the final image prompt; fixed layout comes from execution policy.
- Video uses the cross-media overall style and must not inherit asset-image-only lighting or material treatment.
- User or project style outranks source-image style. A reference preserves identity and structure and cannot override explicit art direction. Ignore incidental source color cast, lighting, blur, noise, and defects.

## Character design

### Visible information for human characters

- Establish gender presentation and a specific age impression.
- Describe face shape and visible facial features, including eye shape and size, but never eye color.
- Describe hair color, length, style, and texture.
- Describe height impression, posture, shoulder width, waistline, body type, and overall silhouette.
- For skin, describe only texture and visible marks such as smoothness, roughness, freckles, birthmarks, scars, or tattoos. Do not describe skin tone, lip color, complexion, eye color, or the color of any body part.
- Clothing includes silhouette, era, material, palette, construction, and detail. Shoes are mandatory in a complete character design and must include style, material, and color.
- Add only wearable accessories that strengthen identity and reuse, such as glasses, earrings, necklaces, watches, or rings.
- Clothing, hair, footwear, and accessories must fit the story's era and social context.

### Non-human characters

- Animals, mythic creatures, non-humanoid beings, and explicitly stylized identities must not be forced into a human appearance template.
- Begin from the character or species identity and describe form, silhouette, surface, defining anatomy, clothing, and core recognition anchors.
- During modification, preserve those identity anchors and change only what the user requests.

### Character-description discipline

- A character asset description contains stable appearance only: no expression, pose, action, background, environment, held story prop, or narrative sentence.
- Do not use uncertainty such as “or,” “possibly,” “maybe,” or “probably.” Every visual choice is concrete.
- Do not write invisible abstractions such as “powerful aura” or “an air of mature confidence.” Translate role energy into visible silhouette, clothing, material, and accessories.
- Explicit source appearance has highest priority while still respecting body-color restrictions and current safety boundaries.
- Preserve reasonable generative freedom. Unless the input demands it, do not lock every facial micro-feature, hair strand, color swatch, or accessory.

## Character reference images

- Extract stable identity from face structure, hairstyle, body type, garment construction, and wearable accessories.
- When the image shows only part of the body, infer compatible lower garments, shoes, arms, and hands from the visible clothing and identity. Added parts must coordinate with visible parts.
- Image-derived descriptions still exclude skin tone, eye color, expression, action, background, and pose.
- Reference analysis may include overall styling or character-impression keywords directly supported by the image. In a final generation description, translate those keywords into visible silhouette, clothing, material, and accessories rather than leaving an unrenderable abstraction.
- When producing an asset board, use attractive normal proportions, complete clothing and footwear, major wearable accessories, a calm neutral expression, stable identity anchors, and a background that supports style without binding the character to a story location. The final image must be clear, sharp, richly detailed, and production-quality rather than inheriting source blur, noise, or defects.
- A simple character reference defaults to one clearly identified character with a complete silhouette and stable wardrobe. Do not automatically create grids, multi-view sheets, or action breakdowns; use an asset-board design only when the requested deliverable requires it.
- “No pose or action” governs the stable identity description and ordinary single-image asset. When the explicit deliverable is a candidate asset board, designated board panels may contain mild, reusable occupation- or identity-specific pose/context samples. Those samples must not change identity, become a plot event, or leak into the stable identity description.

## Character candidates

- Candidates are different design directions for the same character identity, not different characters.
- Useful emphases include identity and silhouette fidelity, wardrobe/material/era texture, and role energy with video-reference usability.
- Differences must be legible while preserving the shared core identity. Do not manufacture variety by changing age, species, relationship, or plot facts.
- When a Style Bible exists, casting, clothing, palette, material, and atmosphere must remain compatible with it.

## Location design

- Start from an explicit scene name or spatial identity and turn a generic label such as “classroom” or “office” into a stable, controllable, real space.
- Faithfully preserve the user's core location identity, important objects, materials, era cues, and spatial relationships. Do not replace it with a familiar but unrelated location category.
- Specify architecture and spatial structure: walls, floor, ceiling, doors, windows, boundaries, openings, scale, and depth.
- Make material, color, and surface condition concrete. Add story-relevant use traces, lived-in detail, and set dressing instead of generic art-direction adjectives.
- Establish clear foreground, midground, and background or near, middle, and far layers. Show a complete environment and understandable boundaries rather than a cropped or ambiguous background.
- Provide at least three stable, clearly visible spatial anchors and usable floor or open space around them for later character placement. This is invisible composition guidance: never draw labels, outlines, boxes, arrows, guide marks, or artificial placeholders.
- For a new final location-generation description, lighting includes a real source, position, time, and visible effect on space. When modifying a foundational location description stored as project fact, retain physical sources and illumination conditions but omit dramatic lighting effects supplied by the Style Bible; the final generation prompt composes that foundation with the asset-image style. Asset-only lighting rules must never become cross-media visual style.
- Do not add people to private spaces or an explicitly empty view. Spaces that inherently imply crowds—banquets, markets, active classrooms—may contain anonymous background groups, but not named leads or narrative actions.
- A location asset is a reusable establishing environment, not a narrative action frame. It contains no dialogue, captions, explanation text, watermark, annotation, arrows, or logo.
- Natural diegetic text on signs, street markers, door numbers, posters, packaging, or screens may remain only when it belongs to the environment. Keep it secondary and natural, without random gibberish or intrusive floating text.

## Location candidates

- Select the single scene most useful for later video reference instead of mechanically repeating the first mentioned place.
- A baseline direction faithfully renders identity, structure, anchors, materials, lighting, and usable placement space.
- A narrative-core direction chooses the location that best carries conflict, revelation, reversal, recurring pressure, or emotional turn. Express tension through architecture, negative space, object placement, motivated light, color, and material rather than explanatory prose.
- A production-texture direction infers era, genre, class texture, emotional temperature, and subtext, then strengthens layout, furniture, props, surfaces, use traces, practical sources, air, reflections, and shadows so every important element serves a purpose.
- Every candidate remains an empty, complete, reusable environment. Do not create differences by adding contradictory story facts.

## Prop design

- Describe only the prop's static visible body: primary structure, silhouette, quantity relationships, material, color, surface treatment, pattern, decoration, and wear.
- Do not describe use, plot, character action, people, hands, tables, rooms, background, camera, or atmospheric lighting.
- The result should support a centered, fully visible, isolated prop asset on a clean background.
- A reference image may contribute silhouette, construction, material, pattern, and palette, but not incidental people or background.

## Modifying an existing asset

- First identify the exact visual features requested for change, then replace or add only the relevant material.
- Preserve every unmodified identity, structure, material, color, decoration, and style fact.
- When a reference image is present, absorb only features relevant to the requested change. Do not let the reference overwrite user-approved content or the Style Bible.
- Recheck fluency, internal consistency, era fit, and asset-type boundaries after modification.
- If a location modification adds or removes a major anchor, update spatial structure, depth layers, and placement space accordingly; never let the description collapse into a generic scene.

## Review

- Does a formal Asset Manifest reference exact canonical entities, cover every registered entity exactly once, and use the project's currently adopted Style Bible?
- For an ordinary single-asset task, if a Style Bible was supplied, does the design follow it and separate cross-media style from asset-only lighting and material treatment? If none was supplied, does the result keep style unbound?
- Is the character stable, complete, era-consistent, explicit about footwear, and free of body color, action, background, uncertainty, and abstract aura?
- Is a non-human identity described through its real form rather than a human template?
- Is the location faithful, structurally complete, layered, anchored, and equipped with unmarked placement space?
- Does the prop contain static object information only?
- Do candidates create meaningful variation without changing identity or plot facts?
- Does a modification preserve everything not requested to change?

## Boundary

This Skill provides visual-design methods for characters, locations, props, reference images, asset candidates, and existing-asset modifications. The visual-style Skill owns Style Bibles, style candidates, and style previews. Output length, candidate count, JSON shape, image aspect ratio, exact asset-board layout, provider parameters, real-person safety policy, and final image-prompt suffixes are defined by the caller and execution layer.
