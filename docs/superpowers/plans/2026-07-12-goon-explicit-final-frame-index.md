# Goon Explicit Final-Frame Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make Goon first/last-frame videos reliably reach the supplied final frame on runtimes that mishandle negative frame indices.

**Architecture:** Extend the existing exact Goon node contract with both conditioning node IDs. Compute the final positive pixel-frame index from the normalized duration and fixed fps, then inject it into both stages.

**Tech Stack:** TypeScript, ComfyUI workflow JSON, Vitest.

## Global Constraints

- Keep first-frame index `0` and conditioning strengths unchanged.
- Apply explicit indices only to `basevideo/ltx23-profiles/goon-first-last-frame-2stage`.
- Use the normalized duration and fixed 24 fps already written into the workflow.

---

## Task 1: Lock the explicit final-frame contract

**Files:**
- Modify: `tests/unit/providers/comfyui/workflow-registry.test.ts`
- Modify: `src/lib/providers/comfyui/workflow-registry.ts`

**Interfaces:**
- Consumes: `normalizeLtx23GoonDurationSeconds(inject.durationSeconds)` and `COMFYUI_LTX23_GOON_FPS`.
- Produces: positive `num_images.index_2` values on Goon nodes `265` and `275`.

- [ ] **Step 1: Add the failing 8-second contract test**

```ts
const graph = resolveComfyUiWorkflow(GOON_KEY, {
  imageFilenames: ['first.png', 'last.png'],
  durationSeconds: 8,
  fps: 24,
})
expect(graph['265'].inputs['num_images.index_2']).toBe(192)
expect(graph['275'].inputs['num_images.index_2']).toBe(192)
```

- [ ] **Step 2: Verify RED**

Run: `npm.cmd exec -- vitest run tests/unit/providers/comfyui/workflow-registry.test.ts`

Expected: FAIL because both values are `-1`.

- [ ] **Step 3: Implement explicit index injection**

Extend `GOON_FIRST_LAST_FRAME_NODE_CONTRACT` with nodes `265` and `275`. Calculate `8 * Math.round((durationSeconds * COMFYUI_LTX23_GOON_FPS) / 8)` and assign it to `num_images.index_2` on both nodes.

- [ ] **Step 4: Verify GREEN**

Run: `npm.cmd exec -- vitest run tests/unit/providers/comfyui/workflow-registry.test.ts`

Expected: PASS.

## Task 2: Verify supported timings and the real runtime

**Files:**
- Modify: `tests/unit/providers/comfyui/workflow-registry.test.ts`

**Interfaces:**
- Consumes: the explicit index behavior from Task 1.
- Produces: regression coverage for 4-second index `96` and 12-second index `288`.

- [ ] **Step 1: Add boundary assertions**

Resolve 4-second and 12-second workflows and assert indices `96` and `288` on both conditioning nodes.

- [ ] **Step 2: Run focused regression tests**

Run: `npm.cmd exec -- vitest run tests/unit/providers/comfyui/workflow-registry.test.ts tests/unit/generators/comfyui-video.test.ts tests/unit/worker/video-worker.test.ts`

Expected: PASS.

- [ ] **Step 3: Run static verification**

Run: `npm.cmd run typecheck` and targeted `npx.cmd eslint` for the modified source and test.

Expected: both exit 0.

- [ ] **Step 4: Run real generation verification**

Generate a 4-second Goon video with the corrected resolver against the configured ComfyUI endpoint. Decode its last frame and visually compare it side-by-side with the supplied target frame; both composition and visible subjects must match.
