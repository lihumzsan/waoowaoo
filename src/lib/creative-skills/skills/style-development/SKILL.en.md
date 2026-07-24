# Visual Style Development

## Purpose

Translate story facts, user requirements, and existing visual context into one visual-style contract shared by images and video, with materially distinct style candidates and preview directions when needed. This Skill governs visual style only; it does not design the specific identity of characters, locations, or props.

## Input-order boundary

- Style may be created from an initial brief before a screenplay, or created and revised after an exact `screenplay` Revision; both orders use the same Style Bible contract.
- Never require screenplay generation before style or style generation before screenplay. Consume only explicitly supplied facts and exact Revisions, never “latest” or “the previous one.”
- A Style Bible does not own screenplay text, and a screenplay does not own visual style. Combine them only in explicit consumers such as asset or video design.

## Style Bible field ownership

- `rawUserStyle` preserves the user's original style intent. It is source evidence, not a normalized generation constraint.
- `styleSummary` helps users understand and compare a direction. It is not itself a generation constraint.
- `visualStyle` is the shared image/video look. It combines artistic medium, image treatment, overall finish, and color palette into one concrete, executable description.
- `assetImageStyle` is used only for asset images such as character, location, prop, and style-preview images:
  - `lighting` defines stylized asset-image lighting;
  - `texture` defines asset-image material and detail treatment.
- Fixed character, location, and prop asset-image layouts belong to schema-specific generation policy, not the Style Bible.
- Video generation consumes only `visualStyle`; it never inherits `assetImageStyle` lighting or material-detail treatment.
- The Style Bible is the sole authority for visual style. Asset design consumes it and must not redefine project style from one reference image or one asset.

## Visual-style boundaries

- Visual style governs artistic medium, image treatment, overall texture, and color direction. It does not decide narrative viewpoint, performance, information rhythm, lens, camera motion, video editing, or sound.
- `visualStyle` excludes lighting, composition, lens, camera movement, and sound; those belong to asset-image policy, directing, video, or sound design.
- Separate the overall visual style shared by images and video from lighting and material-detail rules used only for asset images. Asset-only rules must never leak into cross-media style.
- A style summary helps people understand the direction. Generation-facing style language must be specific and executable rather than vague labels such as “cinematic,” “premium,” or “dreamlike.”
- Translate references to directors, films, studios, movements, or eras into executable medium, material, palette, silhouette, detail density, and image-treatment characteristics instead of depending on protected names themselves.
- An explicit user-selected style and a confirmed project Style Bible outrank the source style of reference images. A reference may provide identity, structure, and material facts, but it cannot override explicit art direction.

## Style candidates

- Every style candidate remains faithful to the same plot, character, location, prop, and time facts.
- Candidates must differ materially in artistic medium, overall finish, palette, and design language, not merely minor color grading.
- Every candidate forms a complete, internally consistent, executable Style Bible rather than a title plus vague adjectives.
- Do not manufacture variation by changing character identity, location facts, story content, era, or events.
- When the user has explicitly requested a style, candidates explore only the reasonable range allowed by that request; they must not demote a clear requirement into an optional suggestion.

## Inspiration vocabulary

Use this library to broaden search and combination space, never as a closed enum or a bag of labels to paste into output. Lock user and screenplay facts first, then choose a small compatible combination. Candidates must differ in at least two visible dimensions, including medium or design language.

- Medium and production surface: live-action realism, documentary, hand-drawn 2D, digital 2D, cel animation, stop motion, clay, puppetry, paper cutout, shadow puppetry, sand, oil paint, watercolor, ink wash, chalk, paint-on-glass, pixel, vector, printmaking, woodcut, low-poly, voxel, toy model, felt, paper craft, fabric puppet, 3D CG, toon shading, rotoscope, live-action hybrid, collage.
- Design language: minimal line art, geometric flat design, grotesque cartoon, dark fairy tale, realistic anime, European picture book, American cartoon, Japanese anime, Chinese art animation, Art Deco, Art Nouveau, Bauhaus, Constructivism, Brutalism, retrofuturism, cyberpunk, solarpunk, steampunk, Y2K, vaporwave, dreamcore, weirdcore, cottagecore, dark academia.
- Color and global image treatment: monochrome, high-contrast grayscale, duotone, desaturated, muted gray, saturated candy, pastel, earth tone, warm-cool contrast, teal-orange, red-black, silver-blue, neon magenta, faded nostalgia, film grain, instant film, VHS, DV, CCD, Hi8, soft focus, halation, chromatic glitch, matte low contrast, crisp digital.
- `assetImageStyle.lighting` only: natural available light, high key, low key, chiaroscuro, hard light, soft light, rim light, top light, back-side light, window light, stage light, neon, fluorescent, sodium vapor, golden hour, blue hour, volumetric haze, shadowless studio. A light source or time cue must remain compatible with established facts.
- `assetImageStyle.texture` only: clean cel fill, clay fingerprints, puppet seams, paper fiber, translucent shadow-puppet fiber, sand grain, impasto, watercolor bloom, ink diffusion, chalk dust, hard pixel edge, vector plane, print indentation, woodcut marks, low-poly facets, toy surface, felt fibers, origami creases, fabric and stitching.
- Semantic inspiration for compatibility only: realism, naturalism, neorealism, poetic realism, magical realism, surrealism, expressionism, impressionism, symbolism, minimalism, maximalism, film noir, road movie, wuxia, crime, horror, romance, nostalgia, dreamlike, alienation, roughness, absurdism, grotesque, epic. Include one only after translating it into single-frame medium, silhouette, color, material, or image treatment.

Merge synonymous families before composing candidates. Do not manufacture difference with near-synonym labels. Translate directors, films, studios, eras, and regions into executable visual properties without inventing world facts.

## Style previews

- A style preview exists to compare visual directions. It is not a new story version or a new source of asset facts.
- Preview imagery uses the candidate's own `visualStyle` and `assetImageStyle`; never mix lighting or texture from another candidate.
- A preview may depict key story moments to demonstrate style fit, but it must not change character identity, location facts, prop state, or story content.
- Incidental preview composition, pose, lighting detail, and generation defects do not automatically become Style Bible or asset facts.

## Interface with asset design

- This Skill defines cross-media visual policy and asset-image policy. Asset design owns stable character appearance, location structure, and prop form.
- `assetImageStyle.lighting` defines the stylized lighting shared by asset images. A location's real physical sources, positions, time, and illumination conditions are location facts supplied by asset design.
- A final asset-image prompt composes stable asset facts with the confirmed Style Bible. It must not write stylized lighting or filters back into stable character or location identity descriptions. Fixed layout is appended by execution policy.
- When reference-image style conflicts with the Style Bible, retain reference-supported identity, silhouette, structure, and material facts while following the Style Bible for the final image treatment.

## Review

- Does `visualStyle` contain only medium, image treatment, overall finish, and palette shared by images and video?
- Does `assetImageStyle` contain only asset-image lighting and texture, with no fixed layout?
- Have abstract or named style references been translated into executable visual traits?
- Do candidates differ materially while remaining faithful to the same story facts?
- Does a preview compare style without creating new plot or asset facts?
- Has one reference image been prevented from redefining confirmed project style?

## Boundary

This Skill provides methods for Style Bibles, style candidates, and style previews. The asset-design Skill owns specific character, location, prop, and reference-asset design; directing, shots, video, sound, and music belong to their respective Skills. Output schemas, candidate count, preview-grid layout, fixed asset-image layouts, image aspect ratio, provider parameters, real-person safety policy, and final generation suffixes are defined by the caller and execution layer.
