# Free Voice Border Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the free voice composer boundary and its three form controls clearly visible without changing layout or behavior.

**Architecture:** Keep the change local to `FreeVoicePanel.tsx`. Reuse the existing semantic glass form classes so default, hover, focus, and disabled states remain consistent with the application design system; add the existing strong stroke token to the composer container.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4 utility classes, Vitest.

## Global Constraints

- Do not change layout, sizing, copy, data flow, API behavior, persistence, or generation behavior.
- Use only existing glass design tokens and semantic classes.
- The composer container must use `--glass-stroke-strong`.
- Select controls must use `glass-select-base`; the textarea must use `glass-textarea-base`.

---

### Task 1: Strengthen the free voice composer borders

**Files:**
- Create: `tests/unit/voice/free-voice-panel-style.test.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel.tsx:130-165`

**Interfaces:**
- Consumes: Existing `glass-surface-soft`, `glass-select-base`, `glass-textarea-base`, and `--glass-stroke-strong` definitions.
- Produces: A visibly bounded composer container with semantic select and textarea interaction states.

- [ ] **Step 1: Write the failing source contract test**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(
  process.cwd(),
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel.tsx',
), 'utf8')

describe('free voice panel styling', () => {
  it('uses visible semantic borders in the composer', () => {
    expect(source).toContain('glass-surface-soft rounded-xl border border-[var(--glass-stroke-strong)]')
    expect(source.match(/className="glass-select-base w-full px-3 py-2\.5/g)).toHaveLength(2)
    expect(source).toContain('className="glass-textarea-base w-full px-3 py-2.5 resize-y"')
    expect(source).not.toContain('className="glass-input w-full')
  })
})
```

- [ ] **Step 2: Run the test and confirm the current markup fails the contract**

Run: `npx.cmd cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/voice/free-voice-panel-style.test.ts`

Expected: FAIL because the container lacks the strong border and the controls still use the nonexistent `glass-input` class.

- [ ] **Step 3: Apply the minimal style fix**

```tsx
<div className="glass-surface-soft rounded-xl border border-[var(--glass-stroke-strong)] p-4 grid gap-4 md:grid-cols-2">
  {/* character select */}
  <select className="glass-select-base w-full px-3 py-2.5">
  {/* voice select */}
  <select className="glass-select-base w-full px-3 py-2.5 disabled:opacity-50">
  {/* spoken text */}
  <textarea className="glass-textarea-base w-full px-3 py-2.5 resize-y" />
</div>
```

- [ ] **Step 4: Run focused verification**

Run: `npx.cmd cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/voice/free-voice-panel-style.test.ts tests/unit/voice/free-voice-ui-state.test.ts`

Expected: 2 test files pass with 4 tests and 0 failures.

Run: `npm.cmd run typecheck`

Expected: exit code 0.

Run: `npx.cmd eslint "src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel.tsx" "tests/unit/voice/free-voice-panel-style.test.ts"`

Expected: exit code 0 with no errors.

- [ ] **Step 5: Inspect the running page and commit**

Verify the composer container, both selects, and textarea have visible default borders; verify focus shows the existing blue focus ring; verify the layout is unchanged.

```powershell
git add -- 'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel.tsx' 'tests/unit/voice/free-voice-panel-style.test.ts'
git commit -m "fix: strengthen free voice input borders"
```
