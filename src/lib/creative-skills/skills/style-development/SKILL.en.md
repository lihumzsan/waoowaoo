# Visual Style Development

## Purpose

Translate story facts, user requirements, and existing visual context into one visual-style contract shared by images and video, with materially distinct style candidates and preview directions when needed. This Skill governs visual style only; it does not design the specific identity of characters, locations, or props.

## Style Bible field ownership

- `rawUserStyle` preserves the user's original style intent. It is source evidence, not a normalized generation constraint.
- `styleSummary` helps users understand and compare a direction. It is not itself a generation constraint.
- `visualStyle` is the shared image/video look. It combines artistic medium, image treatment, overall finish, and color palette into one concrete, executable description.
- `assetImageStyle` is used only for asset images such as character, location, prop, and style-preview images:
  - `lighting` defines stylized asset-image lighting;
  - `texture` defines asset-image material and detail treatment;
  - `composition` defines reusable asset-image composition.
- Video generation consumes only `visualStyle`; it never inherits `assetImageStyle` lighting, material-detail treatment, or asset-board composition.
- The Style Bible is the sole authority for visual style. Asset design consumes it and must not redefine project style from one reference image or one asset.

## Visual-style boundaries

- Visual style governs artistic medium, image treatment, overall texture, and color direction. It does not decide narrative viewpoint, performance, information rhythm, lens, camera motion, video editing, or sound.
- `visualStyle` excludes lighting, composition, lens, camera movement, and sound; those belong to asset-image policy, directing, video, or sound design.
- Separate the overall visual style shared by images and video from lighting, material-detail, and composition rules used only for asset images. Asset-only rules must never leak into cross-media style.
- A style summary helps people understand the direction. Generation-facing style language must be specific and executable rather than vague labels such as “cinematic,” “premium,” or “dreamlike.”
- Translate references to directors, films, studios, movements, or eras into executable medium, material, palette, silhouette, detail density, and image-treatment characteristics instead of depending on protected names themselves.
- An explicit user-selected style and a confirmed project Style Bible outrank the source style of reference images. A reference may provide identity, structure, and material facts, but it cannot override explicit art direction.

## Style candidates

- Every style candidate remains faithful to the same plot, character, location, prop, and time facts.
- Candidates must differ materially in artistic medium, overall finish, palette, and design language, not merely minor color grading.
- Every candidate forms a complete, internally consistent, executable Style Bible rather than a title plus vague adjectives.
- Do not manufacture variation by changing character identity, location facts, story content, era, or events.
- When the user has explicitly requested a style, candidates explore only the reasonable range allowed by that request; they must not demote a clear requirement into an optional suggestion.

## Style previews

- A style preview exists to compare visual directions. It is not a new story version or a new source of asset facts.
- Preview imagery uses the candidate's own `visualStyle` and `assetImageStyle`; never mix lighting, texture, or composition from another candidate.
- A preview may depict key story moments to demonstrate style fit, but it must not change character identity, location facts, prop state, or story content.
- Incidental preview composition, pose, lighting detail, and generation defects do not automatically become Style Bible or asset facts.

## Interface with asset design

- This Skill defines cross-media visual policy and asset-image policy. Asset design owns stable character appearance, location structure, and prop form.
- `assetImageStyle.lighting` defines the stylized lighting shared by asset images. A location's real physical sources, positions, time, and illumination conditions are location facts supplied by asset design.
- A final asset-image prompt composes stable asset facts with the confirmed Style Bible. It must not write stylized lighting, filters, or asset composition back into stable character or location identity descriptions.
- When reference-image style conflicts with the Style Bible, retain reference-supported identity, silhouette, structure, and material facts while following the Style Bible for the final image treatment.

## Review

- Does `visualStyle` contain only medium, image treatment, overall finish, and palette shared by images and video?
- Does `assetImageStyle` contain only asset-image lighting, texture, and composition?
- Have abstract or named style references been translated into executable visual traits?
- Do candidates differ materially while remaining faithful to the same story facts?
- Does a preview compare style without creating new plot or asset facts?
- Has one reference image been prevented from redefining confirmed project style?

## Boundary

This Skill provides methods for Style Bibles, style candidates, and style previews. The asset-design Skill owns specific character, location, prop, and reference-asset design; directing, shots, video, sound, and music belong to their respective Skills. Output schemas, candidate count, preview-grid layout, image aspect ratio, provider parameters, real-person safety policy, and final generation suffixes are defined by the caller and execution layer.
