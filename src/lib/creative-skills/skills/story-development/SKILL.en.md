# Story Development

## Purpose

Turn a one-line idea, fragmentary concept, or existing story material into a complete, coherent, runtime-credible, filmable script. The user input is the only established source of truth. Missing details may be developed, but they must not conflict with characters, locations, relationships, constraints, tone, plot facts, or target runtime.

## Judging the gaps

You are a one-run, stateless Worker with no channel to ask the user anything. Whether to question the user first is the caller's judgment, made through its own selection card; what reaches you is everything currently known. Your job is to decide which gaps you can close yourself and which must go back.

- Identify the genre, facts already locked by the user, and the degree of information scarcity. Look hardest at target runtime, era and setting, genre and tone, protagonist identity, central motivation or desire, core conflict or resistance, key relationships, point of view, ending direction, and important world constraints.
- When a gap does not change the direction of the finished film, make the smallest reversible assumption that conflicts with nothing already known, record it in `assumptions`, and write the complete script anyway. Never stall or deliver a partial script because one detail went unstated.
- When a gap would materially change the finished film — a different answer would produce a different script — still write it through under the most reasonable single reading, and record the fork in `openQuestions`, stating how the alternatives would change motivation, conflict, pacing, or ending.
- Different genres expose different gaps: horror turns on the source and subtype of fear, romance on the relationship and its obstacle, mystery on the mechanism and ownership of truth.
- Character names, every location, complete dialogue, shot details, aspect ratio, model, price, and system parameters are not creative gaps and never belong in `openQuestions`.
- `assumptions` and `openQuestions` record real gaps only. Do not restate facts already established, and never use them in place of a creative decision that belongs in the script itself.

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
- There is one speaking-pace authority, in the “Duration estimation method” section of `continuity-memory`: roughly 4–5 Chinese characters per second or 120–160 English words per minute, counting only words actually spoken. This Skill never states a second figure.
- Derive script volume from it: one minute of dialogue-heavy material is about 240–300 **spoken** Chinese characters, and the script text runs longer once scene headings, action lines, and character names are added. The more action, pauses, atmosphere, or complex staging, the less dialogue should remain.
- Runtime comes from dialogue, action, reaction, pauses, and transitions, not from the number of acts, scenes, or beats.
- Simultaneous content shares one timeline instead of being added in sequence: voice-over, inner monologue, and narration run at the same time as the picture action they cover, and a character can speak while walking or shout while fighting.
- Set the pacing tier by genre: vertical short drama and hook-driven short video reach the conflict quickly, deliberately run dialogue and action in parallel, and cut travel, small talk, repeated observation, and purely expository monologue; slow emotional drama, arthouse work, and suspense build-ups keep the silence, breath, and negative space they need instead of sacrificing an emotional landing for speed.
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

Creative Direction is optional. For `screenplay` and `chapter_plan`, the server supplies the complete adopted direction when one exists. Use whichever domains materially help the current writing or planning judgment and keep them coordinated, without copying production policy into screenplay metadata or changing established story facts. When it is null, work from the supplied request and story facts without inventing a project-wide direction.

## Chapter planning

- For `outputKind=chapter_plan`, use the complete, exactly sourced screenplay as the only source text for Chapter boundaries. A Story Canon or continuity analysis is optional context only when actually supplied; their absence is never a failure condition. The complete adopted Creative Direction may inform which causal, informational, emotional, visual, editorial, or sound transitions make useful production units, but it cannot rewrite the screenplay or override exact ranges.
- A Chapter is an optional creative and execution context unit, not a workflow stage. Plan Chapters only when relatively independent narrative work, parallel production, bounded context, or local recovery has real value. A runtime above 180 seconds is a strong signal to evaluate those needs, never an automatic Chapter count.
- Choose boundaries from story causality, scene or time changes, completed actions, information reveals, and emotional landings. Do not replace creative judgment with average character counts, fixed duration buckets, or mechanical equal splits.
- Every Chapter must stand as a usable context unit. Express its range as UTF-16 character offsets into the exact supplied screenplay, keep ranges ordered and non-overlapping, and keep them inside that screenplay. Do not rewrite, extend, or omit text inside a selected range.
- Each Chapter must be estimated at no more than 180 seconds. This is a local execution constraint after Chapter planning has been chosen, not a workflow threshold that starts it.
