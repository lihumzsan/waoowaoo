# Story Development

## Purpose

Turn a one-line idea, fragmentary concept, or existing story material into a complete, coherent, runtime-credible, filmable script. The user input is the only established source of truth. Missing details may be developed, but they must not conflict with characters, locations, relationships, constraints, tone, plot facts, or target runtime.

## Creative intake

The purpose of intake is not to collect every setting detail. It is to find the minimum missing variables that most strongly change the finished film.

1. Identify the genre, facts already locked by the user, and the degree of information scarcity.
2. Check target runtime, era and setting, genre and tone, protagonist identity, central motivation or desire, core conflict or resistance, key relationships, point of view, ending direction, and important world constraints.
3. Never ask again for something already established. Runtime, motivation, and era/background are especially easy to miss and deserve priority.
4. Keep only high-impact questions whose alternatives would genuinely produce different scripts, ordered by impact. Most tasks need only a small number; a sufficiently complete idea may need none.
5. Ask one dimension at a time. Every direction must be concrete, executable, materially distinct, and explained in ordinary language through its effect on motivation, conflict, pacing, or ending.
6. Different genres require different decisions: horror prioritizes the source and subtype of fear, romance the relationship and obstacle, mystery the mechanism and ownership of truth.
7. Do not ask for character names, every location, complete dialogue, shot details, aspect ratio, model, price, or system parameters that do not determine the writing direction.
8. Do not use “anything,” “AI decides,” “default,” or “other” as creative directions. Free-form additions belong to the caller's interaction design.

## Expanding a complete script

- Write the story itself, not creative commentary, directing notes, a setting document, or process explanation.
- Build a natural episode, act, and scene structure without fixing their count. Each scene is one complete space-time unit, ordered by actual occurrence.
- Every scene has a clear location, present characters, visible action, effective dialogue or narration, and an emotional or informational advance, with a natural connection to adjacent scenes.
- Scene body text must be a complete filmable scene, not a summary. Structural summaries preview; scene bodies perform and narrate.
- Each beat represents the smallest complete advance: an action, discovery, choice, relationship change, emotional turn, goal change, or escalation of risk.
- Once an important identity, relationship, location trait, object, goal, constraint, or state change is established, later scenes must remain consistent with it.
- Dialogue serves action, relationship, and information change. Remove repeated explanation, synonymous lines, and conversation that cannot affect the outcome.
- Action, pauses, reactions, and atmosphere must have performative value. Do not use prose density as a substitute for screen time.

## Runtime control

- When the user specifies a duration, the complete script must actually play within it; a runtime label in the title or summary is insufficient.
- Dialogue-heavy Chinese material may use roughly 300–450 characters per minute as a reference. The more action, pauses, atmosphere, or complex staging, the less text should remain. Estimate other languages from natural speech and real performance time.
- Runtime comes from dialogue, action, reaction, pauses, and transitions, not from the number of acts, scenes, or beats.
- Scene and beat counts must not become a second authority that inflates runtime. A short film may use one scene, but it still needs a clear progression and landing point.
- When over time, cut secondary plot, repeated description, long dialogue, redundant action, and ineffective transitions first. Preserve the user's core facts, relationships, and main line.
- When no duration is specified, write a naturally compact work suited to the story's scale rather than declaring an arbitrary runtime.

## Long stories and segmentation

- Establish the complete main line, character goals, major conflicts, turns, and ending before expanding local scenes.
- Segments follow story order. Metadata within the same episode and act must remain consistent, without duplicates, gaps, reversal, or contradiction.
- One segment is one complete scene. Do not combine discontinuous times and places, and do not mechanically cut an indivisible scene merely to satisfy formatting.
- When the work is long, preserve the original source and global structure. Local expansion should receive the scene's entry state, required event, and exit state so that each segment does not independently rewrite world facts.

## Fidelity and continuity

- Character action must follow established desires, constraints, and information state.
- Characters must not know facts that have not yet occurred, and lost, damaged, or transferred objects must not recover without cause.
- Scene changes need causal or narrative purpose. Time jumps must leave the changed state understandable to the audience.
- Genre, emotion, and language may be enriched, but they cannot override the user's stated story goal.

## Review

- Are all user facts and runtime requirements preserved?
- Are motivation, conflict, relationships, and ending complete, with causal character behavior?
- Is every scene independently filmable and naturally connected to the next?
- Do the scene bodies combine into a complete script rather than a collection of summaries?
- Can the actual dialogue, action, pauses, and transitions fit the target runtime?
- Is there repeated exposition, an ineffective scene, a setting discontinuity, or knowledge acquired too early?

## Boundary

This Skill is the sole screenwriting method for `outputKind=screenplay` and returns only screenplay text plus writing metadata. It must not register production assets, generate asset IDs, build asset-coverage lists, or decide visual production spaces on behalf of asset design. Question counts, fields, JSON structures, size limits, and other strict output protocols are supplied by the caller and are not defined here.

## Chapter planning

- For `outputKind=chapter_plan`, use the complete, exactly sourced screenplay as the only source text for Chapter boundaries. A Bible, continuity analysis, or Style Bible is optional context only when actually supplied; their absence is never a failure condition.
- A Chapter is an optional creative and execution context unit, not a workflow stage. Plan Chapters only when relatively independent narrative work, parallel production, bounded context, or local recovery has real value. A runtime above 180 seconds is a strong signal to evaluate those needs, never an automatic Chapter count.
- Choose boundaries from story causality, scene or time changes, completed actions, information reveals, and emotional landings. Do not replace creative judgment with average character counts, fixed duration buckets, or mechanical equal splits.
- Every Chapter must stand as a usable context unit. Express its range as UTF-16 character offsets into the exact supplied screenplay, keep ranges ordered and non-overlapping, and keep them inside that screenplay. Do not rewrite, extend, or omit text inside a selected range.
- Each Chapter must be estimated at no more than 180 seconds. This is a local execution constraint after Chapter planning has been chosen, not a workflow threshold that starts it.
