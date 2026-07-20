# LTX2.3 KJ Model-Timed Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve each panel's exact recommended duration, force KJ enhancement through GPT-5.5 xhigh/fast, and let the model choose validated non-equal PromptRelay segment timing.

**Architecture:** Keep recommendation selection in the existing shared capability helper. Extend the KJ enhancement response with model-selected frame lengths, validate them against the target frame budget, append canonical `LENGTHS:` metadata, and reuse the existing locked PromptRelay adapter.

**Tech Stack:** TypeScript, React hooks, Vitest, Codex provider, ComfyUI PromptRelay.

## Global Constraints

- Shot 5 in the supplied project must select its 9-second recommendation.
- KJ enhancement uses `codex::gpt-5.5`; Codex runtime remains `xhigh` plus `fast`.
- LOCAL timing must be content-aware and non-equal, with positive integer frames summing to the exact target.
- Output remains fixed at 25 FPS and the LTX 720p profile.

---

### Task 1: Recommended duration regression

**Files:**
- Test: `tests/unit/model-capabilities/video-recommended-duration.test.ts`

**Interfaces:**
- Consumes: `applyRecommendedVideoDurationSelection(selection, { modelKey, recommendedDuration })`.
- Produces: regression evidence that KJ retains a 9-second panel recommendation.

- [ ] Add a test with a saved non-9 duration and `recommendedDuration: 9`, expecting KJ duration 9.
- [ ] Run the focused test and confirm the current shared helper passes.

### Task 2: GPT-5.5 and model-selected timing

**Files:**
- Modify: `src/lib/video-duration/ltx23-prompt-enhance.ts`
- Modify: `lib/prompts/video/ltx23_video_prompt_enhance.zh.txt`
- Modify: `lib/prompts/video/ltx23_video_prompt_enhance.en.txt`
- Test: `tests/unit/video/ltx23-prompt-enhance.test.ts`

**Interfaces:**
- Consumes: `CODEX_DEFAULT_MODEL_KEY` and KJ duration/FPS inputs.
- Produces: a KJ prompt containing canonical `LENGTHS: a,b,c` derived from validated `segment_frames`.

- [ ] Add failing tests proving KJ calls `codex::gpt-5.5`, requests content-aware non-equal `segment_frames`, and accepts `45,105,75` for 225 frames.
- [ ] Add failing tests rejecting equal, wrong-count, non-integer, and wrong-total frame arrays.
- [ ] Run the focused suite and confirm RED.
- [ ] Force GPT-5.5 for KJ, parse and validate `segment_frames`, append canonical `LENGTHS:`, and replace equal timing instructions with a total-budget contract.
- [ ] Add a safe deterministic non-equal fallback allocation and re-run the focused suite to GREEN.

### Task 3: PromptRelay graph propagation

**Files:**
- Test: `tests/unit/providers/comfyui-workflow-registry.test.ts`

**Interfaces:**
- Consumes: canonical KJ `LENGTHS:` metadata.
- Produces: exact unequal `segment_lengths` and matching `timeline_data` in the resolved workflow.

- [ ] Add a graph test for a 225-frame prompt with `LENGTHS: 45,105,75`.
- [ ] Run the focused registry suite and confirm the existing locked adapter propagates the values exactly.

### Task 4: Verification

**Files:**
- Verify only.

- [ ] Run all touched suites and `npm.cmd run typecheck`.
- [ ] Run `git diff --check` and request a read-only code review.
- [ ] In the local app, switch shot 5 to KJ and confirm `9（推荐）`, 25 FPS, 720p, and motion strength controls.
- [ ] Submit a 9-second job to host 112 and verify logs show `codex::gpt-5.5`, a non-equal three-part frame plan totaling 225, and successful generation.
