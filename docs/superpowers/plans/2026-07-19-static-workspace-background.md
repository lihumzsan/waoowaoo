# Static Workspace Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the novel-promotion workspace's animated full-screen aurora with a static blue-gray CSS gradient that preserves the glass aesthetic without continuous repainting.

**Architecture:** Keep one presentational background component mounted by `NovelPromotionWorkspace`. Replace the oversized blurred child layers with one fixed, pointer-events-disabled element using static radial gradients, then remove only the now-unused aurora/blob CSS.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, Vitest, TypeScript

## Global Constraints

- Preserve the existing soft blue-gray glass aesthetic.
- Do not add bitmap assets or network requests.
- Do not change workspace data flow, task handling, navigation, cards, buttons, or page-transition animations.
- Do not retain full-screen animation, a 200% layer, `blur(100px)`, or `backdrop-blur` in the workspace background.

---

### Task 1: Replace the Animated Workspace Background

**Files:**
- Create: `tests/unit/components/static-workspace-background.test.ts`
- Modify: `src/components/ui/SharedComponents.tsx:3-18`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/NovelPromotionWorkspace.tsx:6,79`
- Modify: `src/styles/animations.css:27-60,70-84`

**Interfaces:**
- Consumes: Existing glass CSS variables `--glass-bg-canvas`, `--glass-bg-surface-strong`, and `--glass-bg-muted`.
- Produces: `WorkspaceBackground(): JSX.Element`, a state-free presentational component used by `NovelPromotionWorkspace`.

- [ ] **Step 1: Write the failing source-contract test**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('static workspace background', () => {
  it('uses a static gradient without the full-screen aurora animation', () => {
    const componentSource = readFileSync(
      resolve(process.cwd(), 'src/components/ui/SharedComponents.tsx'),
      'utf8',
    )
    const workspaceSource = readFileSync(
      resolve(process.cwd(), 'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/NovelPromotionWorkspace.tsx'),
      'utf8',
    )
    const animationSource = readFileSync(
      resolve(process.cwd(), 'src/styles/animations.css'),
      'utf8',
    )

    expect(componentSource).toContain('export function WorkspaceBackground()')
    expect(componentSource).toContain('radial-gradient')
    expect(componentSource).toContain('pointer-events-none')
    expect(componentSource).not.toMatch(/animate-(?:aurora|blob)/)
    expect(componentSource).not.toContain('blur-[100px]')
    expect(componentSource).not.toContain('w-[200%]')
    expect(workspaceSource).toContain("import { WorkspaceBackground }")
    expect(workspaceSource).toContain('<WorkspaceBackground />')
    expect(workspaceSource).not.toContain('AnimatedBackground')
    expect(animationSource).not.toMatch(/@keyframes\s+(?:aurora|blob)/)
    expect(animationSource).not.toMatch(/\.animate-(?:aurora|blob)/)
    expect(animationSource).not.toMatch(/\.animation-delay-(?:2000|4000)/)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx.cmd vitest run tests/unit/components/static-workspace-background.test.ts`

Expected: FAIL because `WorkspaceBackground` and the static gradient do not exist yet.

- [ ] **Step 3: Implement the static component and remove obsolete CSS**

Replace `AnimatedBackground` with:

```tsx
/**
 * Static blue-gray background for the project workspace.
 */
export function WorkspaceBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 bg-[var(--glass-bg-canvas)]"
      style={{
        background: [
          'radial-gradient(ellipse at 18% 12%, color-mix(in srgb, var(--glass-bg-surface-strong) 72%, transparent) 0%, transparent 58%)',
          'radial-gradient(ellipse at 82% 88%, color-mix(in srgb, var(--glass-bg-muted) 70%, transparent) 0%, transparent 62%)',
          'var(--glass-bg-canvas)',
        ].join(', '),
      }}
    />
  )
}
```

Update `NovelPromotionWorkspace` to import and render `WorkspaceBackground`. Delete `@keyframes aurora`, `@keyframes blob`, `.animate-aurora`, `.animate-blob`, `.animation-delay-2000`, and `.animation-delay-4000`; preserve every other animation.

- [ ] **Step 4: Run focused verification**

Run: `npx.cmd vitest run tests/unit/components/static-workspace-background.test.ts`

Expected: PASS, 1 test passed.

Run: `npm.cmd run typecheck`

Expected: exit code 0 with no TypeScript errors.

Run: `rg -n "AnimatedBackground|animate-aurora|animate-blob|@keyframes aurora|@keyframes blob|animation-delay-(2000|4000)" src`

Expected: no matches.

- [ ] **Step 5: Verify the live workspace**

Open the existing local project workspace and confirm:

- The background remains a soft blue-gray static gradient.
- `document.querySelectorAll('[class*="animate-aurora"], [class*="animate-blob"]').length` is `0`.
- No computed animation named `aurora` or `blob` is present.
- Workspace navigation, project cards, and controls remain visible and usable.

- [ ] **Step 6: Commit the implementation**

```powershell
git add -- src/components/ui/SharedComponents.tsx src/app/[locale]/workspace/[projectId]/modes/novel-promotion/NovelPromotionWorkspace.tsx src/styles/animations.css tests/unit/components/static-workspace-background.test.ts
git commit -m "fix(ui): make workspace background static"
```
