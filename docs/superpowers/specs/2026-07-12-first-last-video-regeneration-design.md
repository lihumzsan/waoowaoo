# First/Last Video Regeneration Design

## Problem

Saving a manually edited first/last-frame prompt can leave the prompt entry in an unverified `queued` state. The video action then remains disabled by both the active-prompt guard and `ready === false`. When a first/last-frame video already exists, the same action is labeled as already generated, which hides that it should support regeneration.

## Desired behavior

- A successfully saved manual prompt is authoritative for the current first/last-frame source signature.
- Saving a non-empty manual prompt finishes in `idle` and `ready` state without scheduling prompt regeneration.
- When a first/last-frame video exists, the action remains available and is labeled "Regenerate first/last-frame video".
- A running video task, a prompt save/generation task, missing source images, missing model configuration, or invalid capabilities may still disable the action.
- The existing video remains visible while regeneration runs and is replaced only after the new generation succeeds.
- A failed regeneration leaves the existing video intact.

## Design

After persistence succeeds, the prompt-entry hook records the current source signature as verified and marks the user prompt ready. The existing source-change watcher therefore sees a current authoritative prompt and does not enqueue an unnecessary transition-prompt task.

The panel action label distinguishes initial generation from regeneration. Existing video presence affects only the label; it does not add a disabled condition. The current generation pipeline already persists the replacement only after generation and upload succeed, so retaining the previous video requires no destructive pre-task update.

## Error handling

If prompt persistence fails, retain the editable user value and expose the existing error state. If video regeneration fails, leave the existing video URL and generation mode unchanged while surfacing the task error through the current task presentation.

## Tests

- Prompt-state test: a saved manual prompt can be marked ready for the current source signature and remains idle.
- Panel-card test: an existing first/last-frame video renders an enabled regeneration action when all prerequisites are ready.
- Panel-card test: real blockers such as an active video task still disable regeneration.
- Existing worker/API tests continue to verify that video metadata changes only after a successful generation.
