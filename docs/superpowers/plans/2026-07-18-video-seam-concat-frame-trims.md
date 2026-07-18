# Video Seam Concat Frame Trims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exact configurable Video 1 tail-frame and Video 2 head-frame trimming to the existing seam-concat tool.

**Architecture:** Carry two validated integers from the React page through the submission parser and BullMQ payload into the ComfyUI client. Replace the fixed one-frame time slice with an exact image-batch slicing graph and matching audio trims computed from each source FPS.

**Tech Stack:** Next.js, React, TypeScript, next-intl, BullMQ, ComfyUI API workflows, Vitest.

## Global Constraints

- Video 1 tail trim defaults to `0` frames.
- Video 2 head trim defaults to `1` frame.
- Accepted values are integers from `0` through `100000`.
- Visual trimming is exact by frame index; matching audio is trimmed from frame-count/FPS boundaries.
- Output remains NVENC H.264 MP4, `yuv420p`, 10 Mbit/s, at Video 1 FPS.
- Existing callers and queued payloads that omit trim values retain defaults `0` and `1`.
- No database migration or unrelated refactor.

---

### Task 1: Define and validate the trim contract

**Files:**
- Modify: `tests/unit/video-tools/seam-concat.test.ts`
- Modify: `tests/unit/video-tools/video-tools-state.test.ts`
- Modify: `src/lib/video-tools/seam-concat.ts`
- Modify: `src/app/[locale]/workspace/video-tools/video-tools-state.ts`

**Interfaces:**
- Produces `VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES`, parser fields `input1TrimEndFrames` and `input2TrimStartFrames`, and `isValidVideoTrimFrames(value)`.

- [ ] Add failing tests for default/custom parser values and invalid integers.
- [ ] Add failing state tests for trim-aware submit enablement.
- [ ] Run the two tests and confirm expected RED failures.
- [ ] Implement minimal shared validation and parser defaults.
- [ ] Run the two tests and confirm GREEN.

### Task 2: Inject exact frame slicing into the ComfyUI graph

**Files:**
- Modify: `tests/unit/providers/comfyui-workflow-registry.test.ts`
- Modify: `tests/unit/providers/comfyui-client.test.ts`
- Modify: `src/lib/providers/comfyui/workflow-registry.ts`
- Modify: `src/lib/providers/comfyui/client.ts`
- Modify: `src/lib/providers/comfyui/workflows/basevideo/tools/video-seam-concat-nvenc.json`

**Interfaces:**
- Consumes `videoTrimFrames: [trimEndFrames, trimStartFrames]`.
- Produces a graph using `GetImageSize`, `ImageFromBatch`, and `TrimAudioDuration` before existing image/audio concatenation.

- [ ] Add failing registry and client assertions for custom `3/4` trims.
- [ ] Run targeted provider tests and confirm expected RED failures.
- [ ] Add `videoTrimFrames` injection and replace the fixed graph.
- [ ] Run targeted provider tests and confirm GREEN.

### Task 3: Carry trims through the worker and page

**Files:**
- Modify: `tests/unit/worker/video-seam-concat.test.ts`
- Modify: `src/lib/workers/handlers/video-seam-concat.ts`
- Modify: `src/app/[locale]/workspace/video-tools/page.tsx`
- Modify: `src/app/[locale]/workspace/video-tools/VideoUploadCard.tsx`
- Modify: `messages/zh/videoTools.json`
- Modify: `messages/en/videoTools.json`

**Interfaces:**
- Page request nests the controls under `input1.trimEndFrames` and `input2.trimStartFrames`.
- Worker forwards both values and returns them in result metadata.

- [ ] Add failing worker expectations for trim forwarding and metadata.
- [ ] Run the worker test and confirm expected RED failure.
- [ ] Implement worker defaults/forwarding and the two controlled number fields.
- [ ] Update bilingual copy to describe configurable trimming.
- [ ] Run worker/state/parser/provider tests and confirm GREEN.

### Task 4: Verify the integrated change

**Files:**
- Modify only if verification exposes a tested defect.

- [ ] Parse both locale JSON files.
- [ ] Run all focused video-tools, provider, and worker tests.
- [ ] Run TypeScript typecheck.
- [ ] Run `git diff --check` and inspect the scoped diff without altering unrelated worktree changes.
