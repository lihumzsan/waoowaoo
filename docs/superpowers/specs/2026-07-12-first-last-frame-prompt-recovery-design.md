# First/Last-Frame Prompt Recovery Design

## Goal

Restore the first/last-frame video flow to a usable state after regenerating a transition prompt:

- A successfully completed transition-prompt task must not leave the video-generation button disabled.
- Deterministic fallback prompts must not recursively embed an older first/last-frame prompt.

## Root Causes

The client readiness signature includes the selected UI model even though the canonical prompt fingerprint already pins the Goon workflow. If model options hydrate or normalize while a prompt task is running, the completed result is treated as belonging to an older source and the derived UI returns to `queued`.

The deterministic fallback builder prefers an existing `firstLastFramePrompt` over the panel's original action text. Regenerating a fallback therefore wraps the previous bridge inside a new bridge and duplicates the structural phrases.

## Design

### Readiness recovery

Build the client source signature only from `buildFirstLastFramePromptFingerprintInput`. Do not include the selected UI model. The canonical input already contains the fixed workflow key, FPS, duration, image identity, and both panels' prompt context.

Keep the existing safety behavior:

- A completed result is ready only for the exact canonical source signature captured when its request began.
- A genuine source change still clears readiness and triggers regeneration.
- Persisted prompts loaded after a page refresh continue through the existing server-side fingerprint validation path before becoming ready.

### Fallback prompt construction

Build deterministic first/last-frame prompts from the first panel's original video action (then description, source text, or image prompt) and the last panel's original action. Never use `firstLastFramePrompt` as input to this fallback builder.

This makes fallback generation idempotent: running it repeatedly for unchanged panels produces the same single bridge instead of nesting previous output.

## Tests

Use test-driven development with two regression cases:

1. A completed prompt remains ready when only the selected UI model changes or hydrates, while real canonical source changes still invalidate readiness.
2. Calling the deterministic fallback builder with a panel that already contains a generated first/last-frame prompt produces exactly one `Start from the first frame` section and one `Bridge naturally into the last frame` section, based on the original video action.

Run the focused prompt-entry, panel-continuity, worker, and panel-card tests. Then run TypeScript checking or the repository's nearest equivalent validation for the touched modules.

## Non-goals

- No database migration or API contract expansion.
- No weakening of stale-prompt safeguards.
- No unrelated changes to video generation, model configuration, or visual layout.
