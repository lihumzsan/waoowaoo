# Screenplay Canonicalization

## Purpose

When the current goal explicitly needs structured screenplay analysis, normalize newly generated, pasted, imported, or revised screenplays into the same `canonical_screenplay` semantics. User-authored source text may already be stored as an ordinary text Resource; this Skill is not a storage, confirmation, or "formal screenplay" gate. Source differences belong only in `source`; they must not create alternative entity, scene, reference, confirmation, or extraction states.

## Entity registry

- Exhaustively register recurring stable identities as characters, locations, or independent props.
- Use the clearest stable screenplay name as `canonicalName`; put alternate names in `aliases` and never split one entity into multiple entries.
- Register screenplay facts only. Do not invent appearance design, production design, image prompts, or asset scope for the sake of later image generation.
- Do not promote anonymous crowds, background passersby, or incidental environmental objects into standalone entities without a stable identity.
- Do not invent database IDs. Refer by registered names exactly as required by the output contract; the server deterministically compiles stable IDs.

## Scenes and references

- Split the screenplay into real chronological time-and-place units with exact UTF-16 `sourceStart` and `sourceEnd` ranges inside `screenplayText`; ranges must be ordered and non-overlapping.
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
- Does every ordered scene range correspond to real screenplay text without overlap?
- Does every scene reference resolve to a registered entity?
- Did any asset design, style, full state ledger, or workflow status leak into canonicalization?
