# Run Stream Render Loop Fix Design

## Problem

The workspace mounts two run-stream hooks even when the current stage does not use task recovery. Each hook starts a 500 ms clock unconditionally. On the videos stage those clock updates rerender the workspace and all video panels. Video-panel hooks also synchronize derived object values into local state, so referentially new but semantically equal inputs can cause redundant state writes and, under the current render chain, React's `Maximum update depth exceeded` error.

## Goals

- Stop idle, completed, and failed run streams from scheduling periodic clock updates.
- Preserve elapsed-time updates while a live or recovered run is active.
- Prevent video-panel synchronization effects from replacing local state with semantically equal values.
- Preserve task recovery, stream progress, video configuration, and video generation behavior.
- Add regression coverage before changing production code.

## Non-goals

- Refactoring the full workspace controller or video-panel architecture.
- Changing run recovery, retry, cancellation, or persistence semantics.
- Modifying unrelated migration work already present in the worktree.

## Design

### Active-only run-stream clock

Derive a single `shouldTickClock` boolean from the live-running flag, recovered-running flag, and `runState.status === 'running'`. The clock effect starts an interval only while this value is true and cleans it up when the run becomes inactive. Entering an active state also refreshes the clock immediately so elapsed-time output does not begin from a stale idle timestamp.

The clock scheduling decision will be extracted into a small pure helper. This makes the idle and active cases directly testable without introducing a browser-hook testing dependency.

### Semantic state synchronization

Video duration bindings and video generation selections are small JSON-compatible records. Synchronization helpers will compare their normalized semantic values and retain the previous state object when the values are equal. Effects will use functional state updates so equality is evaluated against the actual current state.

The comparison boundary remains local to each hook. No global deep-equality dependency will be added.

## Testing

1. Add pure unit tests showing that idle/completed/failed streams do not tick and live/recovered/running streams do.
2. Add unit tests showing that equivalent normalized video binding and generation selection values retain the previous object reference, while changed values replace it.
3. Run the new tests once before implementation and confirm they fail for missing exports/behavior.
4. Implement the minimum production changes and rerun the focused tests.
5. Run TypeScript validation and relevant existing run-stream/video unit tests.
6. Reload the reported workspace URL and observe it across multiple 500 ms periods while checking browser errors for `Maximum update depth exceeded`.

## Success Criteria

- No interval is scheduled for an inactive run stream.
- Active run progress continues to update on a 500 ms cadence.
- Equivalent video state does not trigger a state replacement.
- The reported videos-stage URL remains usable without the React update-depth error.
- Existing unrelated worktree changes remain untouched.
