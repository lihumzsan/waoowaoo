# Storyboard Bounded Rendering Design

**Date:** 2026-07-22

**Status:** Approved

**Scope:** Novel-promotion storyboard stage UI

## Context

The storyboard stage currently loads every storyboard group and mounts every panel card when the stage opens. Image elements beyond the initial priority set are lazy-loaded, but the browser still creates the React tree, edit forms, task state, and event handlers for all panels. As an episode grows, opening the stage therefore performs work proportional to the total number of panels.

The existing source-text disclosure does not solve this problem: it only hides or shows the source text for a group, while the group's panel list remains mounted.

## Goal

Bound the number of mounted storyboard edit cards to at most one storyboard group while preserving existing storyboard editing, ordering, task progress, and group-level actions.

When the stage opens, one useful group is expanded by default. Other groups remain visible as compact summaries, but their panel cards, images, and edit forms are not mounted until the user expands that group.

## Non-goals

- Do not change the storyboard API, database schema, mutations, or task protocol.
- Do not add backend pagination or request-on-expand loading in this phase.
- Do not virtualize panels within the active group.
- Do not redesign panel cards or group actions.
- Do not combine panel-list expansion with the existing source-text expansion state.

Backend lazy loading can be evaluated as a second phase if browser profiling shows that fetching or task-state processing remains a bottleneck after bounded rendering is shipped.

## Interaction Design

### Single active group

The canvas owns an `openStoryboardId: string | null` state that is independent from the existing source-text expansion state.

- Expanding a collapsed group switches the active group to that group.
- Expanding a different group closes the previous group, so at most one panel list is mounted.
- Collapsing the active group sets the state to `null`; all groups then remain summarized.
- Source text can still be expanded or collapsed independently in any group.

### Default selection

On initial entry, choose the first group that needs attention. A group needs attention when any of the following is true:

1. The group has a recorded error.
2. The group's storyboard task is running.
3. Any panel image task is running.
4. Any panel does not yet have an image.

If no group needs attention, open the first group. If the episode contains no groups, use `null`.

Once the user has a valid active group, later task-status changes must not automatically switch the active group. This avoids the UI jumping while work is in progress.

### Collapsed group content

A collapsed group keeps the controls and context needed to understand and operate on it:

- Group index, title, dialogue status, and move controls.
- Existing source-text disclosure.
- Existing group actions, including batch generation, add, regenerate, and delete.
- Current progress and panel counts.
- Insert-between-groups controls.
- A compact panel summary showing total, pending, and running counts.
- A clear expand control using the existing expand/collapse terminology.

It does not mount `StoryboardPanelList`, `PanelCard`, panel edit forms, or panel images.

### Expanded group content

The expanded group mounts the existing `StoryboardPanelList` unchanged in behavior. Panel selection, editing, image generation, drag/reorder controls, deletion, and additions continue to work as before.

Panel numbering remains global and is calculated from the complete storyboard collection, not from only the mounted group.

## State and Component Design

Introduce small pure visibility helpers close to the storyboard state code:

- `resolveDefaultOpenStoryboardId(storyboards)` selects the deterministic default described above.
- `reconcileOpenStoryboardId(currentId, storyboards)` preserves a valid current ID and falls back only when that group no longer exists.
- `toggleOpenStoryboardId(currentId, targetId)` returns `null` for the active target and otherwise returns the target ID.

`useStoryboardState` owns and reconciles `openStoryboardId`, then exposes the ID and toggle callback to the canvas.

The component flow becomes:

1. `StoryboardCanvas` determines whether each group matches `openStoryboardId`.
2. `StoryboardGroup` renders its always-visible header, controls, and summary.
3. `StoryboardGroup` conditionally mounts `StoryboardPanelList` only when it is the active group.

Task subscriptions and the loaded storyboard data remain global in this phase. This lets collapsed summaries continue reflecting progress without changing async behavior.

## Data and Error Handling

- Episode or group-list changes reconcile the active ID against the latest groups.
- If the active group is deleted, moved out of the current episode, or otherwise disappears, select a new default using the same attention-first rule.
- Reordering groups preserves the active group by ID.
- An empty episode has no active group and renders the existing empty state.
- Errors that arrive after the user manually collapses all groups do not force a group open.
- Existing request, task, and mutation error handling remains unchanged.

## Accessibility and Responsive Behavior

- The expand/collapse control must be a real button with `aria-expanded` and an association to the panel-list region.
- The control must remain keyboard operable and expose an adequate hit target on desktop and mobile.
- Collapsed summaries must not introduce horizontal overflow at a 390 px viewport.
- Focus must remain predictable when switching groups; the implementation must not programmatically move focus unless a deleted group removes the focused element.

## Testing Strategy

Implementation follows test-driven development.

### Unit tests

Cover the pure state rules first:

- Attention priority and first-group fallback.
- Empty collection behavior.
- Preservation of an existing active ID.
- Deleted active-group fallback.
- Toggle-to-open, switch, and toggle-to-collapse behavior.
- No automatic switch when task status changes but the active ID still exists.

Add a component-level regression test that verifies collapsed groups do not render panel-list content and that switching the active group keeps only one list mounted. The test should assert user-visible or stable accessibility behavior, not the internals of mocks.

### Existing regression checks

Run the relevant storyboard component/unit suite, TypeScript checking, and any repository-prescribed frontend checks. Existing group actions, source-text disclosure, numbering, insertion, and reorder paths must continue to pass.

### Browser verification

Verify the real stage at desktop and 390 px mobile widths:

- Initial entry expands only the expected group.
- Collapsed groups contain no panel images or edit forms in the DOM.
- Expanding another group unmounts the previous panel list.
- Source-text disclosure remains independent.
- Group actions and insert controls remain available.
- No horizontal overflow or visible layout regression appears.

If a usable local project, authentication state, or storyboard fixture is unavailable, report the exact browser-verification blocker instead of claiming a visual pass.

## Success Criteria

- Opening an episode with multiple groups mounts panel cards for no more than one group.
- A user can explicitly collapse all groups or switch the active group.
- The active group remains stable across task progress updates and reorder operations.
- Deleting the active group selects a sensible replacement without leaving stale state.
- Collapsed groups preserve summaries and group-level operations but mount no panel cards, images, or panel edit forms.
- Existing source-text expansion, global numbering, editing, generation, insertion, and reorder behavior remains intact.
