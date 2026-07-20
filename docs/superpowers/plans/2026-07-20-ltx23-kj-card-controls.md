# LTX2.3 KJ Card Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the KJ 720p PromptRelay model Bernini-style recommended duration and motion strength controls while retaining central Codex timeline enhancement.

**Architecture:** Generalize the existing recommended-duration predicate to include the KJ workflow, add the shared 1/2/3 capability metadata, and adapt those values to KJ's image-guide strength at graph resolution. Carry the selected strength into the existing LTX2.3 prompt-enhancement context and verify the relay's exact frame allocation.

**Tech Stack:** TypeScript, React hooks, Vitest, ComfyUI workflow registry, JSON capability catalog.

## Global Constraints

- Keep KJ output fixed at 720p and 25 FPS.
- Keep the project Codex enhancer; do not restore the workflow's machine-local Codex node.
- Default motion strength is `1`.
- Use TDD and run a live host-112 generation after local verification.

---

### Task 1: Recommended duration eligibility

**Files:**
- Modify: `src/lib/model-capabilities/video-recommended-duration.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts`
- Test: `tests/unit/model-capabilities/video-recommended-duration.test.ts`

**Interfaces:**
- Produces: `supportsRecommendedVideoDuration(modelKey): boolean` used by both selection and UI recommendation labeling.

- [x] Add a failing test proving KJ receives and selects the per-panel recommendation while unrelated models do not.
- [x] Run `npx.cmd vitest run tests/unit/model-capabilities/video-recommended-duration.test.ts` and confirm RED.
- [x] Implement the shared eligibility predicate and replace the Bernini-only hook check.
- [x] Re-run the focused test and confirm GREEN.

### Task 2: Motion strength capability and graph adapter

**Files:**
- Modify: `standards/capabilities/image-video.catalog.json`
- Modify: `src/lib/providers/comfyui/ltx23-workflow-profiles.ts`
- Modify: `src/lib/providers/comfyui/workflow-registry.ts`
- Test: `tests/unit/model-capabilities/comfyui-video-capabilities.test.ts`
- Test: `tests/unit/providers/comfyui-workflow-registry.test.ts`

**Interfaces:**
- Produces: `normalizeLtx23KjMotionStrength(value): 1 | 2 | 3` and `resolveLtx23KjImageGuideStrength(value): number`.
- Injects the mapped value into node `620`, input `num_images.strength_1`.

- [x] Add failing catalog and graph tests for options `[1,2,3]`, default `1`, and mappings `1.0/0.85/0.70`.
- [x] Run the two focused suites and confirm RED.
- [x] Add capability metadata, normalization, and profile-specific node injection.
- [x] Re-run the focused suites and confirm GREEN.

### Task 3: Codex motion/timeline context

**Files:**
- Modify: `src/lib/video-duration/ltx23-prompt-enhance.ts`
- Modify: `src/lib/workers/video.worker.ts`
- Test: `tests/unit/video/ltx23-prompt-enhance.test.ts`

**Interfaces:**
- `EnhanceLtx23VideoPromptInput.motionStrength?: number | null` carries the selected card value.
- The KJ generation context states duration, FPS, the exact 3/4/5 numbered LOCAL-stage plan, and selected motion strength.

- [x] Add a failing test that captures the Codex request and asserts KJ duration, 25 FPS, PromptRelay stages, and motion level.
- [x] Run `npx.cmd vitest run tests/unit/video/ltx23-prompt-enhance.test.ts` and confirm RED.
- [x] Pass `effectiveGenerationOptions.motionStrength` from the worker and render the motion policy in generation context.
- [x] Re-run the focused suite and confirm GREEN.

### Task 4: Full and live verification

**Files:**
- Verify only.

- [x] Run all touched unit suites together and confirm zero failures.
- [x] Run `npm.cmd run typecheck` and confirm exit code 0.
- [x] Inspect `git diff --check` and the scoped diff.
- [x] Submit a short KJ image-to-video job to host 112 using the supplied test image, wait for completion, and verify the resolved graph keeps 720p/25 FPS, recommended duration, selected motion mapping, and exact PromptRelay frame intervals.
