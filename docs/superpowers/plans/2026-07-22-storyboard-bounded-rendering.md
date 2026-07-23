# Storyboard Bounded Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount editable storyboard panels for at most one storyboard group while keeping every group visible and operable through a compact summary.

**Architecture:** Add pure functions for deterministic default selection, reconciliation, and toggling, then own that state in the existing `useStoryboardState` flow. Thread the active ID through the controller and canvas, and make `StoryboardGroup` conditionally mount the existing panel list behind an accessible disclosure row without changing data fetching, task subscriptions, or panel behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript, next-intl, Tailwind utility classes, Vitest, React server rendering tests, Playwright/browser verification.

## Global Constraints

- Mount `StoryboardPanelList` for at most one group; a user may collapse all groups.
- Keep panel-list expansion independent from the existing source-text expansion state.
- Preserve all loaded storyboard data, task subscriptions, global panel numbering, group actions, insertion, reordering, and panel editing behavior.
- Do not change APIs, persistence, task protocols, dependencies, or panel-card design.
- Do not automatically switch away from a still-valid active group when task status changes.
- Reconcile deleted groups and episode changes deterministically.
- Use real buttons with `aria-expanded` and `aria-controls` for panel-list disclosure.
- Avoid horizontal overflow at 390 px and verify the real UI at desktop and mobile widths.
- Preserve all unrelated dirty worktree changes, especially the in-progress episode-cover feature.

---

### Task 1: Storyboard panel-list visibility state

**Files:**
- Create: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/storyboard-group-visibility.ts`
- Create: `tests/unit/novel-promotion/storyboard-group-visibility.test.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardState.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardStageController.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/index.tsx`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardCanvas.tsx`

**Interfaces:**
- Consumes: task-aware `NovelPromotionStoryboard[]` already passed into `useStoryboardState`.
- Produces: `resolveDefaultOpenStoryboardId(storyboards): string | null`, `reconcileOpenStoryboardId(currentId, storyboards): string | null`, `toggleOpenStoryboardId(currentId, targetId): string | null`, plus `openStoryboardId` and `toggleOpenStoryboard(storyboardId)` from `useStoryboardState`.

- [ ] **Step 1: Write the failing visibility-rule test**

```ts
import { describe, expect, it } from 'vitest'
import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import {
  reconcileOpenStoryboardId,
  resolveDefaultOpenStoryboardId,
  toggleOpenStoryboardId,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/storyboard-group-visibility'

function panel(id: string, imageUrl: string | null, imageTaskRunning = false) {
  return { id, imageUrl, imageTaskRunning } as NovelPromotionPanel
}

function storyboard(
  id: string,
  overrides: Partial<NovelPromotionStoryboard> = {},
): NovelPromotionStoryboard {
  return {
    id,
    episodeId: 'episode-1',
    clipId: `clip-${id}`,
    storyboardTextJson: null,
    panelCount: 0,
    storyboardImageUrl: null,
    panels: [],
    ...overrides,
  }
}

describe('storyboard group visibility', () => {
  it('opens the first group needing attention before complete groups', () => {
    const groups = [
      storyboard('complete', { panels: [panel('p1', '/p1.webp')] }),
      storyboard('missing', { panels: [panel('p2', null)] }),
      storyboard('running', { storyboardTaskRunning: true }),
    ]

    expect(resolveDefaultOpenStoryboardId(groups)).toBe('missing')
  })

  it('treats errors and running panel tasks as attention states', () => {
    expect(resolveDefaultOpenStoryboardId([
      storyboard('complete'),
      storyboard('error', { lastError: 'failed' }),
    ])).toBe('error')
    expect(resolveDefaultOpenStoryboardId([
      storyboard('complete'),
      storyboard('running-panel', { panels: [panel('p2', '/p2.webp', true)] }),
    ])).toBe('running-panel')
  })

  it('falls back to the first group and returns null for an empty collection', () => {
    expect(resolveDefaultOpenStoryboardId([storyboard('first'), storyboard('second')])).toBe('first')
    expect(resolveDefaultOpenStoryboardId([])).toBeNull()
  })

  it('preserves a valid selection across task-state changes', () => {
    expect(reconcileOpenStoryboardId('second', [
      storyboard('first', { lastError: 'new error' }),
      storyboard('second'),
    ])).toBe('second')
  })

  it('preserves an explicit collapsed-all state and replaces a deleted selection', () => {
    const groups = [storyboard('first'), storyboard('second')]
    expect(reconcileOpenStoryboardId(null, groups)).toBeNull()
    expect(reconcileOpenStoryboardId('deleted', groups)).toBe('first')
  })

  it('opens, switches, and collapses one active group', () => {
    expect(toggleOpenStoryboardId(null, 'first')).toBe('first')
    expect(toggleOpenStoryboardId('first', 'second')).toBe('second')
    expect(toggleOpenStoryboardId('second', 'second')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run tests/unit/novel-promotion/storyboard-group-visibility.test.ts
```

Expected: FAIL because `storyboard-group-visibility` does not exist.

- [ ] **Step 3: Implement the pure visibility rules**

```ts
import type { NovelPromotionStoryboard } from '@/types/project'

function needsAttention(storyboard: NovelPromotionStoryboard) {
  return Boolean(
    storyboard.lastError
    || storyboard.storyboardTaskRunning
    || (storyboard.panels ?? []).some((panel) => panel.imageTaskRunning || !panel.imageUrl),
  )
}

export function resolveDefaultOpenStoryboardId(storyboards: NovelPromotionStoryboard[]) {
  return storyboards.find(needsAttention)?.id ?? storyboards[0]?.id ?? null
}

export function reconcileOpenStoryboardId(
  currentId: string | null,
  storyboards: NovelPromotionStoryboard[],
) {
  if (currentId === null) return null
  return storyboards.some((storyboard) => storyboard.id === currentId)
    ? currentId
    : resolveDefaultOpenStoryboardId(storyboards)
}

export function toggleOpenStoryboardId(currentId: string | null, targetId: string) {
  return currentId === targetId ? null : targetId
}
```

- [ ] **Step 4: Run the visibility test and verify GREEN**

Run:

```bash
npx vitest run tests/unit/novel-promotion/storyboard-group-visibility.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Wire the state through the existing controller chain**

In `useStoryboardState.ts`, import `useEffect`, import the three helpers, and add an episode-aware state object so a new episode receives a fresh default while `null` remains stable within the same episode:

```ts
const [openStoryboardState, setOpenStoryboardState] = useState(() => ({
  episodeId,
  storyboardId: resolveDefaultOpenStoryboardId(localStoryboards),
}))

useEffect(() => {
  setOpenStoryboardState((previous) => {
    const storyboardId = previous.episodeId === episodeId
      ? reconcileOpenStoryboardId(previous.storyboardId, localStoryboards)
      : resolveDefaultOpenStoryboardId(localStoryboards)
    if (previous.episodeId === episodeId && previous.storyboardId === storyboardId) return previous
    return { episodeId, storyboardId }
  })
}, [episodeId, localStoryboards])

const toggleOpenStoryboard = useCallback((storyboardId: string) => {
  setOpenStoryboardState((previous) => ({
    episodeId,
    storyboardId: toggleOpenStoryboardId(
      previous.episodeId === episodeId
        ? previous.storyboardId
        : resolveDefaultOpenStoryboardId(localStoryboards),
      storyboardId,
    ),
  }))
}, [episodeId, localStoryboards])
```

Return `openStoryboardId: openStoryboardState.storyboardId` and `toggleOpenStoryboard`. Destructure and return both from `useStoryboardStageController.ts`; destructure them in `storyboard/index.tsx`; pass them to `StoryboardCanvas` as `openStoryboardId` and `onToggleOpenStoryboard`.

In `StoryboardCanvas.tsx`, add these exact props:

```ts
openStoryboardId: string | null
onToggleOpenStoryboard: (storyboardId: string) => void
```

Accept these props at the `StoryboardCanvas` boundary without passing them to `StoryboardGroup` yet. Task 2 consumes the values after adding the group-level disclosure props, which keeps this task independently type-safe.

- [ ] **Step 6: Run the visibility test and TypeScript check**

Run:

```bash
npx vitest run tests/unit/novel-promotion/storyboard-group-visibility.test.ts
npx tsc --noEmit
```

Expected: the visibility test and typecheck pass. There are no expected temporary type errors.

- [ ] **Step 7: Commit the state behavior**

```bash
git add -- tests/unit/novel-promotion/storyboard-group-visibility.test.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/storyboard-group-visibility.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardState.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardStageController.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/index.tsx src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardCanvas.tsx
git commit -m "feat: track the active storyboard group"
```

Before committing, verify `git diff --cached --name-status` contains only these paths; because `storyboard/index.tsx` already has user-owned changes, stage its intended hunk interactively or defer that file to the combined Task 2 commit rather than staging unrelated hunks.

---

### Task 2: Accessible bounded panel-list rendering

**Files:**
- Create: `tests/unit/novel-promotion/storyboard-group-bounded-rendering.test.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup.types.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup.tsx`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupActions.tsx`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardCanvas.tsx`
- Modify: `messages/zh/storyboard.json`
- Modify: `messages/en/storyboard.json`

**Interfaces:**
- Consumes: `isPanelListExpanded: boolean` and `onTogglePanelList(): void` from Task 1.
- Produces: an accessible disclosure row and a conditionally mounted `StoryboardPanelList`; source-text props are renamed to `isSourceExpanded` and `onToggleSource` to make the two disclosures unambiguous.

- [ ] **Step 1: Write the failing component regression test**

Create the complete React server-rendering test below. It mocks only expensive child boundaries and renders the real `StoryboardGroup`, so the assertions exercise the production conditional mount and accessibility attributes:

```ts
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import StoryboardGroup from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup'
import type { StoryboardGroupProps } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup.types'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { name: string }) => createElement('span', { 'data-icon': name }),
}))
vi.mock('@/components/task/TaskStatusOverlay', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/ScreenplayDisplay', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupHeader', () => ({
  default: () => createElement('header', null, 'group-header'),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupActions', () => ({
  default: () => createElement('nav', null, 'group-actions'),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardPanelList', () => ({
  default: () => createElement('div', { 'data-testid': 'storyboard-panel-list' }),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupFailedAlert', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupDialogs', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardGroupTaskErrors', () => ({
  useStoryboardGroupTaskErrors: () => ({ panelTaskErrorMap: new Map(), clearPanelTaskError: vi.fn() }),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardInsertVariantRuntime', () => ({
  useStoryboardInsertVariantRuntime: () => ({
    insertModalOpen: false,
    insertAfterPanel: null,
    nextPanelForInsert: null,
    variantModalPanel: null,
    handleOpenInsertModal: vi.fn(),
    handleCloseInsertModal: vi.fn(),
    handleInsert: vi.fn(),
    handleOpenVariantModal: vi.fn(),
    handleCloseVariantModal: vi.fn(),
    handleVariant: vi.fn(),
  }),
}))

vi.stubGlobal('React', React)

const noop = vi.fn()
const baseProps = {
  storyboard: {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    clipId: 'clip-1',
    storyboardTextJson: null,
    panelCount: 1,
    storyboardImageUrl: null,
  },
  clip: undefined,
  sbIndex: 0,
  totalStoryboards: 2,
  textPanels: [{
    id: 'panel-1',
    panelIndex: 0,
    panel_number: 1,
    shot_type: 'medium',
    camera_move: null,
    description: 'panel',
    characters: [],
    imageUrl: null,
  }],
  storyboardStartIndex: 0,
  videoRatio: '16:9',
  isSourceExpanded: false,
  isPanelListExpanded: false,
  isSubmittingStoryboardTask: false,
  isSelectingCandidate: false,
  isSubmittingStoryboardTextTask: false,
  hasAnyImage: false,
  failedError: null,
  savingPanels: new Set<string>(),
  deletingPanelIds: new Set<string>(),
  saveStateByPanel: {},
  hasUnsavedByPanel: new Set<string>(),
  modifyingPanels: new Set<string>(),
  submittingPanelImageIds: new Set<string>(),
  onToggleSource: noop,
  onTogglePanelList: noop,
  onMoveUp: noop,
  onMoveDown: noop,
  onRegenerateText: noop,
  onAddPanel: noop,
  onDeleteStoryboard: noop,
  onGenerateAllIndividually: noop,
  onPreviewImage: noop,
  onCloseError: noop,
  getPanelEditData: (panel) => ({
    id: panel.id,
    panelIndex: panel.panelIndex,
    panelNumber: panel.panel_number,
    shotType: panel.shot_type,
    cameraMove: panel.camera_move,
    description: panel.description,
    location: null,
    characters: [],
    srtStart: null,
    srtEnd: null,
    duration: null,
    imageModel: null,
    videoPrompt: null,
  }),
  storyboardWorkflowOptions: [],
  defaultStoryboardWorkflow: '',
  onPanelUpdate: noop,
  onPanelDelete: noop,
  onOpenCharacterPicker: noop,
  onOpenLocationPicker: noop,
  onRemoveCharacter: noop,
  onRemoveLocation: noop,
  onRetryPanelSave: noop,
  onRegeneratePanelImage: noop,
  onOpenEditModal: noop,
  onOpenAIDataModal: noop,
  getPanelCandidates: () => null,
  onSelectPanelCandidateIndex: noop,
  onConfirmPanelCandidate: async () => undefined,
  onCancelPanelCandidate: noop,
  formatClipTitle: () => 'Segment 1',
  movingClipId: null,
  onInsertPanel: async () => undefined,
  insertingAfterPanelId: null,
  projectId: 'project-1',
  episodeId: 'episode-1',
  onPanelVariant: async () => undefined,
  submittingVariantPanelId: null,
} satisfies StoryboardGroupProps

function renderGroup(overrides: Partial<StoryboardGroupProps>) {
  return renderToStaticMarkup(createElement(StoryboardGroup, { ...baseProps, ...overrides }))
}

describe('StoryboardGroup bounded rendering', () => {
  it('summarizes a collapsed group without mounting its panel list', () => {
    const html = renderGroup({ isPanelListExpanded: false })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('group.panelSummary')
    expect(html).not.toContain('data-testid="storyboard-panel-list"')
  })

  it('mounts the panel list only when the group is expanded', () => {
    const html = renderGroup({ isPanelListExpanded: true })
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-testid="storyboard-panel-list"')
    expect(html).toContain('id="storyboard-panel-list-storyboard-1"')
  })
})
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npx vitest run tests/unit/novel-promotion/storyboard-group-bounded-rendering.test.ts
```

Expected: FAIL because `StoryboardGroup` does not yet accept or use `isPanelListExpanded`, always mounts the mocked list, and has no panel-list disclosure button.

- [ ] **Step 3: Add explicit source and panel disclosure props**

Update `StoryboardGroupProps`:

```ts
isSourceExpanded: boolean
isPanelListExpanded: boolean
onToggleSource: () => void
onTogglePanelList: () => void
```

Remove the ambiguous `isExpanded` and `onToggleExpand` names. Update `StoryboardCanvas` to pass source-text state through `isSourceExpanded`/`onToggleSource` and Task 1's active-group state through `isPanelListExpanded`/`onTogglePanelList`.

Keep the header and actions compact without mobile overflow by changing the group header/actions wrapper to:

```tsx
<div className="mb-4 flex flex-col gap-3 pb-2 xl:flex-row xl:items-start xl:justify-between">
```

Change the root action container in `StoryboardGroupActions.tsx` to:

```tsx
<div className="flex flex-wrap items-center justify-end gap-2">
```

- [ ] **Step 4: Render the summary and conditionally mount the list**

In `StoryboardGroup.tsx`, keep the existing source-text button but use `isSourceExpanded` and `onToggleSource`. Add this row immediately before the panel list:

```tsx
<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-stroke-base)] pt-4">
  <p className="min-w-0 text-sm text-[var(--glass-text-secondary)]">
    {t('group.panelSummary', {
      total: textPanels.length,
      pending: pendingCount,
      running: currentRunningCount,
    })}
  </p>
  <button
    type="button"
    onClick={onTogglePanelList}
    aria-expanded={isPanelListExpanded}
    aria-controls={`storyboard-panel-list-${storyboard.id}`}
    className="glass-btn-base glass-btn-soft shrink-0 rounded-xl px-3 py-2 text-sm"
  >
    <AppIcon
      name="chevronRightMd"
      className={`h-4 w-4 transition-transform ${isPanelListExpanded ? 'rotate-90' : ''}`}
    />
    <span>{t(isPanelListExpanded ? 'group.collapse' : 'group.expand')}</span>
  </button>
</div>

{isPanelListExpanded && (
  <div
    id={`storyboard-panel-list-${storyboard.id}`}
    role="region"
    aria-label={t('group.panelListLabel', { index: sbIndex + 1 })}
    className="mt-4"
  >
    <StoryboardPanelList
      storyboardId={storyboard.id}
      textPanels={textPanels}
      storyboardStartIndex={storyboardStartIndex}
      videoRatio={videoRatio}
      isSubmittingStoryboardTextTask={isSubmittingStoryboardTextTask}
      savingPanels={savingPanels}
      deletingPanelIds={deletingPanelIds}
      saveStateByPanel={saveStateByPanel}
      hasUnsavedByPanel={hasUnsavedByPanel}
      modifyingPanels={modifyingPanels}
      panelTaskErrorMap={panelTaskErrorMap}
      isPanelTaskRunning={isPanelTaskRunning}
      getPanelEditData={getPanelEditData}
      storyboardWorkflowOptions={storyboardWorkflowOptions}
      defaultStoryboardWorkflow={defaultStoryboardWorkflow}
      getPanelCandidates={getPanelCandidates}
      onPanelUpdate={onPanelUpdate}
      onPanelDelete={onPanelDelete}
      onOpenCharacterPicker={onOpenCharacterPicker}
      onOpenLocationPicker={onOpenLocationPicker}
      onRemoveCharacter={onRemoveCharacter}
      onRemoveLocation={onRemoveLocation}
      onRetryPanelSave={onRetryPanelSave}
      onRegeneratePanelImage={handleRegeneratePanelImage}
      onOpenEditModal={onOpenEditModal}
      onOpenAIDataModal={onOpenAIDataModal}
      onSelectPanelCandidateIndex={onSelectPanelCandidateIndex}
      onConfirmPanelCandidate={onConfirmPanelCandidate}
      onCancelPanelCandidate={onCancelPanelCandidate}
      onClearPanelTaskError={clearPanelTaskError}
      onPreviewImage={onPreviewImage}
      onInsertAfter={handleOpenInsertModal}
      onVariant={handleOpenVariantModal}
      isInsertDisabled={(panelId) =>
        isSubmittingStoryboardTextTask
        || insertingAfterPanelId === panelId
        || submittingVariantPanelId === panelId
      }
    />
  </div>
)}
```

Keep all current `StoryboardPanelList` props verbatim inside the conditional wrapper. Keep `StoryboardGroupDialogs` outside the wrapper so an already-open dialog can settle predictably if external state changes.

Add translations without replacing the current episode-cover keys or other dirty message changes:

```json
"panelSummary": "共 {total} 个镜头 · 待生成 {pending} · 生成中 {running}",
"panelListLabel": "第 {index} 个分镜组的镜头列表"
```

```json
"panelSummary": "{total} panels · {pending} pending · {running} running",
"panelListLabel": "Panel list for storyboard group {index}"
```

- [ ] **Step 5: Run component, state, and existing storyboard tests**

Run:

```bash
npx vitest run tests/unit/novel-promotion/storyboard-group-bounded-rendering.test.ts tests/unit/novel-promotion/storyboard-group-visibility.test.ts tests/unit/novel-promotion/storyboard-group-task-errors.test.ts tests/unit/novel-promotion/storyboard-panel-card-workflow-selector.test.ts
```

Expected: all targeted tests pass with no warnings.

- [ ] **Step 6: Run typecheck and repository frontend guards**

Run:

```bash
npx tsc --noEmit
npm run check:file-line-count
```

Expected: both commands pass. If the line-count guard rejects the expanded `StoryboardGroup`, extract only the disclosure UI into a focused production component and move its real rendering test with it; do not add a guard exception.

- [ ] **Step 7: Commit bounded rendering without unrelated hunks**

```bash
git add -- tests/unit/novel-promotion/storyboard-group-bounded-rendering.test.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup.types.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup.tsx src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupActions.tsx src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardCanvas.tsx
git commit -m "feat: bound storyboard panel rendering"
```

Stage only the two new translation properties from each already-dirty message file, or defer them to a dedicated exact-hunk commit. Never stage the existing episode-cover translations as part of this task.

---

### Task 3: Real-browser interaction and responsive acceptance

**Files:**
- Verify: storyboard workspace route with an episode containing at least two storyboard groups.
- Evidence: `output/storyboard-bounded-rendering-desktop.png`
- Evidence: `output/storyboard-bounded-rendering-mobile.png`

**Interfaces:**
- Consumes: the completed active-group state and disclosure UI.
- Produces: runtime and screenshot evidence that only one group's panels mount and the collapsed layout remains usable.

- [ ] **Step 1: Start or reuse the real local app**

Use the repository's existing dev process when available. Otherwise run:

```bash
npm run dev:next
```

Expected: the local Next.js page becomes reachable. Do not start a second server on an occupied port.

- [ ] **Step 2: Verify desktop interaction at 1365×768**

Open a real episode with at least two groups and assert:

```js
document.querySelectorAll('[id^="storyboard-panel-list-"]').length === 1
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Confirm the attention-first group is initially open, click another group's expand button, confirm the previous region unmounts and the count remains one, then collapse the active group and confirm the count becomes zero. Independently toggle source text and verify it does not change the panel-list count. Save `output/storyboard-bounded-rendering-desktop.png`.

- [ ] **Step 3: Verify mobile behavior at 390×844**

Repeat expansion switching and assert:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Check the collapsed summary, disclosure button, group actions, and insert-between-groups control remain visible and operable without horizontal scrolling. Save `output/storyboard-bounded-rendering-mobile.png`.

- [ ] **Step 4: Run final fresh verification**

Run:

```bash
npx vitest run tests/unit/novel-promotion/storyboard-group-bounded-rendering.test.ts tests/unit/novel-promotion/storyboard-group-visibility.test.ts tests/unit/novel-promotion/storyboard-group-task-errors.test.ts tests/unit/novel-promotion/storyboard-panel-card-workflow-selector.test.ts
npx tsc --noEmit
npm run check:file-line-count
git diff --check
```

Expected: all tests and static checks pass. Review `git diff --name-status` and `git diff` to confirm every changed hunk belongs to this feature or is a pre-existing user change.

- [ ] **Step 5: Record any verification blocker exactly**

If local data, authentication, external services, or browser tooling prevents screenshots, record the failing route, visible error, and missing prerequisite. Do not substitute unit tests for the visual acceptance claim and do not claim the UI passed.
