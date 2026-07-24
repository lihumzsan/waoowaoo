# Screenplay Canonicalization

## Purpose

When the current goal explicitly needs structured screenplay analysis, normalize newly generated, pasted, imported, or revised screenplays into the same `canonical_screenplay` semantics. User-authored source text may already be stored as an ordinary text Resource; this Skill is not a storage, confirmation, or "formal screenplay" gate. Source differences belong only in `source`; they must not create alternative entity, scene, reference, confirmation, or extraction states.

## Entity registry

- Exhaustively register every character, location, and independent prop that needs a stable identity. Recurrence is not a registration threshold: an entity that appears only once but genuinely carries on-screen action or a key plot beat must still be registered.
- Register locations as distinct visual spaces where on-screen action happens, never merged by place name or geographic containment. Visually distinct areas of the same geographic place that each host story action (for example a cliff edge on a mountaintop versus the cliff base after a fall) must be registered as separate location entities; express their spatial relationship in `description`, and never demote one action space to an "extension" of another registered location.
- Do not register as standalone locations: places only mentioned in dialogue, narration, or inner thoughts without on-screen action; passing spaces that flash by in transitions; or views of the same space that differ only in camera position, direction, or shot size.
- Use the clearest stable screenplay name as `canonicalName`; put alternate names in `aliases` and never split one entity into multiple entries.
- Register screenplay facts only. Do not invent appearance design, production design, image prompts, or asset scope for the sake of later image generation.
- Do not promote anonymous crowds, background passersby, or incidental environmental objects into standalone entities without a stable identity.
- Do not invent database IDs. Refer by registered names exactly as required by the output contract; the server deterministically compiles stable IDs.

## Scenes and references

- Split the screenplay into real chronological time-and-place units with exact UTF-16 `sourceStart` and `sourceEnd` ranges inside `screenplayText`; ranges must be ordered and non-overlapping.
- A real shift of place or time starts a new time-and-place unit. When one continuous action (such as a fall or a chase) crosses two registered locations, split the scene at the spatial transition so each scene references the location where its action actually happens.
- Each scene references one registered location and every registered character or independent prop actually present in that scene.
- References must use a registered `canonicalName` or alias. Never introduce an unregistered identity in scene references.
- A scene reference is a screenplay fact, not an image-generation request.

## Two inputs, one output

- For creation from zero, finish the screenplay with story-development methods, then perform this registry and reference pass in the same Creative Task.
- When Primary explicitly requests this structured analysis for a user-provided screenplay, preserve its creative choices and normalize the exact source Revision's text, entities, scene ranges, and references. Put only genuinely ambiguous facts in `openQuestions`.
- Both paths must return the same `canonical_screenplay` contract without an extra state or second screenplay copy.

## Boundary

Do not design assets, write asset prompts, adopt a Style Bible, maintain a complete state-transition ledger, or decide Chapters. Optional continuity state belongs to `continuity_analysis` or Bible capabilities.

## Checks

- Is every identity registered exactly once with unambiguous aliases?
- Are distinct action spaces under one geographic name registered separately and referenced by their own scenes?
- Does every ordered scene range correspond to real screenplay text without overlap?
- Does every scene reference resolve to a registered entity?
- Did any asset design, style, full state ledger, or workflow status leak into canonicalization?
