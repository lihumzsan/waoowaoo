# H3 Ref T8 Workflow Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace only MiniMax H3 `reference` with the validated T8 4+5 graph, preserve all seven ratios, enforce the tested duration/MP table, and retain ordered 8-image/3-audio references.

**Architecture:** The video capability registry owns model ratios and per-mode durations. A pure H3 runtime-plan module joins the `17n+5` frame oracle to the closed MP table; the Ref graph builder derives 32-aligned dimensions from ratio plus MP and injects them into one sanitized API graph. Existing create-video, provider fence, ComfyUI target, external id, poll/cancel, and Task/Resource terminal writers remain unchanged authorities.

**Tech Stack:** TypeScript, Vitest, Prisma integration tests, ComfyUI API graphs, `fetch`/`FormData`, optional ffprobe runtime verification.

**Spec:** `docs/superpowers/specs/2026-09-06-h3-reference-t8-workflow-replacement-design.md`

## Global Constraints

- Ref supports integer 5–15 seconds and all existing ratios: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `9:21`.
- `first_frame`, `first_last_frame`, and `continuation` keep their current graphs, ratios, and 4–11 second behavior.
- The approved first/second MP values are mandatory runtime facts, not defaults or user options.
- Preserve 1–8 ordered images and 0–3 ordered audios; audio requires an image.
- Output is H.264/yuv420p/CRF10/24fps MP4 at 2MP area with native H3 audio.
- Delete the old Ref graph and old Ref builder path; add no fallback, compatibility parser, or graph-version switch.
- Image reads stay inside `outbound-image`; all media reads remain owner/version aware and bounded.
- Do not copy UI metadata, local paths, COS data, or disconnected nodes from the attachment.
- Do not modify architecture documents or unrelated workspace files.

---

### Task 1: Add the capability, duration, dimension, and MP authorities

**Files:**
- Create: `src/lib/ai-registry/video-input-policy.ts`
- Create: `src/lib/video-generation/h3-reference-runtime-plan.ts`
- Create: `tests/unit/ai-registry/video-input-policy.test.ts`
- Modify: `src/lib/ai-registry/types.ts`
- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/video-generation/h3-duration.ts`
- Modify: `src/lib/project-production-context.ts`
- Modify: `tests/unit/video-generation/h3-duration.test.ts`
- Modify: `tests/contracts/project-production-prompt-profile-conformance.test.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`

**Interfaces:**
- Produces `VideoInputModePolicy`, `VideoCapabilities.aspectRatioOptions`, and `VideoCapabilities.inputModePolicies`.
- Produces `resolveVideoInputPolicySelection`, mode-aware `resolveH3DurationPlan`, `resolveH3ReferenceRuntimePlan`, and `resolveH3ReferenceDimensions`.

- [ ] **Step 1: Write failing policy and runtime-plan tests**

Add real production-catalog assertions:

```ts
expect(resolveVideoInputPolicySelection({ capabilities, inputMode: 'reference', requestedDurationSeconds: 15, aspectRatio: '9:21' })).toMatchObject({ requestedDurationSeconds: 15, aspectRatio: '9:21' })
expect(() => resolveVideoInputPolicySelection({ capabilities, inputMode: 'first_frame', requestedDurationSeconds: 12, aspectRatio: '16:9' })).toThrow('VIDEO_INPUT_MODE_DURATION_UNSUPPORTED:first_frame:12')
expect(resolveH3ReferenceRuntimePlan(15)).toEqual({ requestedDurationSeconds: 15, frameCount: 362, promptEndSeconds: 15.083, firstPassMegapixels: 0.47, secondPassMegapixels: 0.67 })
expect(resolveH3ReferenceDimensions({ aspectRatio: '16:9', megapixels: 2 })).toEqual({ width: 1920, height: 1088 })
```

Cover all 11 Ref rows, all seven ratios, the three unchanged modes, malformed policy shapes, fractional durations, and continuation's 22 guide frames.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npx vitest run tests/unit/ai-registry/video-input-policy.test.ts tests/unit/video-generation/h3-duration.test.ts tests/contracts/project-production-prompt-profile-conformance.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
```

Expected: missing resolvers/types and the current global `[4..11]` duration contract fail.

- [ ] **Step 3: Implement the strict shared policy**

```ts
export interface VideoInputModePolicy { durationOptions: number[] }
export interface VideoCapabilities {
  promptProfile: VideoPromptProfile
  supportedInputModes?: VideoInputMode[]
  aspectRatioOptions?: string[]
  inputModePolicies?: Partial<Record<VideoInputMode, VideoInputModePolicy>>
}
```

Remove top-level video `durationOptions`. Validation requires exactly one policy key per supported mode, no extras, only `durationOptions`, and non-empty unique positive safe integers. Ratios must be non-empty, unique canonical `W:H` strings. `resolveVideoInputPolicySelection` rejects unsupported mode, duration, and ratio without coercion.

- [ ] **Step 4: Implement H3 duration, MP, and dimensions**

```ts
export const H3_STANDARD_DURATION_OPTIONS_SECONDS = [4, 5, 6, 7, 8, 9, 10, 11] as const
export const H3_REFERENCE_DURATION_OPTIONS_SECONDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const
export function resolveH3DurationPlan(input: { inputMode: VideoInputMode; requestedDurationSeconds: number }): H3DurationPlan
```

Delete `resolveH3ContinuationDurationPlan`; only `continuation` adds 22 guide frames. Define the exact table:

```ts
const H3_REFERENCE_PASS_MEGAPIXELS = {
  5: [0.70, 1.00], 6: [0.70, 1.00], 7: [0.70, 1.00], 8: [0.70, 1.00],
  9: [0.70, 1.00], 10: [0.70, 1.00], 11: [0.61, 0.88], 12: [0.58, 0.83],
  13: [0.52, 0.75], 14: [0.49, 0.71], 15: [0.47, 0.67],
} as const
```

Dimensions use `megapixels * 1024 * 1024`, the canonical ratio, nearest multiple 32, and accept `9:21` without ComfyUI UI enum labels.

- [ ] **Step 5: Publish the H3 policy and project context**

H3 capability declares all seven `aspectRatioOptions` plus Ref `[5..15]` and the other three modes `[4..11]`. Project context validates the project ratio, publishes `allowedSegmentDurationsSeconds=[4..15]`, and builds exact per-mode `segmentDurationPlans` with the mode-aware resolver.

- [ ] **Step 6: Run Step 2 tests and verify GREEN**

Expected: all policy, formula, projection, and continuation assertions pass.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/ai-registry/types.ts src/lib/ai-registry/video-input-policy.ts src/lib/ai-providers/comfyui/models.ts src/lib/video-generation/h3-duration.ts src/lib/video-generation/h3-reference-runtime-plan.ts src/lib/project-production-context.ts tests/unit/ai-registry/video-input-policy.test.ts tests/unit/video-generation/h3-duration.test.ts tests/contracts/project-production-prompt-profile-conformance.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
git commit -m "feat(video): add mode-aware H3 reference load policy"
```

---

### Task 2: Enforce the selected policy before writes and at Provider defense

**Files:**
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `tests/integration/task/project-video-model-config.integration.test.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`

**Interfaces:**
- Consumes the Task 1 policy resolver.
- Produces pre-write exact mode/duration/ratio rejection; adapter schema remains broad structural validation.

- [ ] **Step 1: Write failing boundary tests**

In the existing Prisma-backed planning test, prove Ref+15+9:21 proceeds while first-frame+12, continuation+15, Ref+4, and an unsupported ratio fail with unchanged Resource/Task counts. At provider contract, prove Ref 15 passes structural schema but first-frame 12 is rejected after the execution path resolves its mode.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run tests/integration/task/project-video-model-config.integration.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
```

- [ ] **Step 3: Implement the Planner gate**

In `compileMediaExecution`, resolve the input mode from frozen reference roles and call:

```ts
resolveVideoInputPolicySelection({ capabilities, inputMode: resolvedMode.mode, requestedDurationSeconds: item.durationSeconds, aspectRatio })
```

Map an unsupported ratio through existing `PROJECT_VIDEO_RATIO_UNSUPPORTED_BY_MODEL`; map an unsupported mode duration to the existing capability-invalid response. Update Prompt validation to use `resolveH3DurationPlan({ inputMode, requestedDurationSeconds })`.

- [ ] **Step 4: Make adapter validation structural**

Allow integer duration 4–15 and the seven production ratios in the ComfyUI option schema. Keep `generateAudio=true`, reference counts, and forbidden fields. Exact mode duration remains the shared resolver's job inside `h3.ts`.

- [ ] **Step 5: Run Step 2 tests and verify GREEN, then commit**

```powershell
git add src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/ai-providers/comfyui/adapter.ts tests/integration/task/project-video-model-config.integration.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
git commit -m "fix(video): enforce H3 duration policy before writes"
```

---

### Task 3: Replace the Ref graph and builder

**Files:**
- Create: `src/lib/ai-providers/comfyui/workflows/h3-reference-t8-dual-stage-2mp.json`
- Delete: `src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json`
- Modify: `src/lib/ai-providers/comfyui/profiles.ts`
- Modify: `tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`

**Interfaces:**
- Consumes Task 1 runtime plan and dimensions.
- Produces the only Ref runtime profile with two T8 conditioning nodes and output node `168`.

- [ ] **Step 1: Write failing graph tests**

```ts
expect(nodes.filter(node => node.class_type === 'MiniMaxH3AudioConditioningT8')).toHaveLength(2)
expect(nodes.some(node => node.class_type === 'MiniMaxH3LearnedTwoPassParityPlanT8Advanced')).toBe(true)
expect(nodes.some(node => node.class_type === 'ResolutionSelector')).toBe(false)
expect(nodes.some(node => node.class_type === 'ComfyMathExpression')).toBe(false)
expect(profile.workflow['168']?.inputs).toMatchObject({ format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 10, frame_rate: 24 })
```

Build 5-second 9:16, 10-second 21:9, and 15-second 9:21 graphs. Assert both conditioning nodes share Prompt/frame count/references, low dimensions use first MP, learned upscaler uses second MP, final RTX VSR uses 2MP dimensions, references are ordered, and template is immutable.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
```

- [ ] **Step 3: Create the sanitized canonical graph**

Retain the attachment's VAE/CLIP/UNET, LoRA chains and weights, Sage/PyTorch/Sol attention patches, two T8 conditioning nodes, DualClock sampler, 4+5 parity plan, two guiders/samplers, learned latent upscale, latent reconcile, detail mixer, AV decode, RTX VSR, native audio, and output. Remove all UI metadata, disconnected nodes, duration/math nodes 27/30, ResolutionSelector nodes 29/54, and machine/COS data. Include one template `LoadImage` and `LoadAudio`; set output id 168 to H.264/yuv420p/CRF10/24fps.

- [ ] **Step 4: Implement the Ref builder**

The profile declares both conditioning IDs, learned upscaler, loader templates, final RTX VSR, Prompt/noise, and output. Builder injects:

```ts
const first = resolveH3ReferenceDimensions({ aspectRatio, megapixels: runtimePlan.firstPassMegapixels })
const final = resolveH3ReferenceDimensions({ aspectRatio, megapixels: 2 })
```

Write low width/height, both lengths and Prompts, `target_megapixels`, final width/height, seed, and exactly 1–8 image plus 0–3 audio loader connections to both conditioning nodes. Delete the old URL-loader/resize branch.

- [ ] **Step 5: Run Step 2 tests and verify GREEN, then commit**

```powershell
git add src/lib/ai-providers/comfyui/profiles.ts src/lib/ai-providers/comfyui/workflows/h3-reference-t8-dual-stage-2mp.json tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
git rm src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json
git commit -m "feat(video): replace H3 Ref with T8 dual-stage graph"
```

---

### Task 4: Materialize and upload owned reference images

**Files:**
- Modify: `src/lib/media/outbound-image.ts`
- Modify: `src/lib/ai-providers/comfyui/h3-input-upload.ts`
- Modify: `tests/integration/security/outbound-image.security.test.ts`
- Modify: `tests/integration/provider/comfyui-h3-input-upload.contract.test.ts`

**Interfaces:**
- Produces `readOwnedImageBytesForGeneration` and `uploadH3ReferenceImages`.

- [ ] **Step 1: Write failing ownership/upload tests**

Use real storage-backed media to prove only the owner can obtain detected JPEG/PNG/WebP bytes. Use the scenario server to prove ordered names `reference-image-00` through `reference-image-07`, and explicit failure for 0/9 files, empty bytes, MIME-extension mismatch, and invalid upload response identity.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run tests/integration/security/outbound-image.security.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts
```

- [ ] **Step 3: Add the image-specific owned-byte projection**

```ts
export type OwnedOutboundImageBytes = { readonly bytes: Uint8Array; readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp' }
export async function readOwnedImageBytesForGeneration(input: string, userId: string): Promise<OwnedOutboundImageBytes>
```

It reuses `readOwnedMediaBytesForGeneration` with `MAX_IMAGE_BYTES`, current MIME set, and detected-MIME enforcement. Refactor the existing data-URL helper to consume it.

- [ ] **Step 4: Add sequential H3 image upload**

```ts
export type H3ReferenceImageFile = { readonly bytes: Uint8Array; readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp'; readonly extension: 'jpg' | 'png' | 'webp' }
```

Require 1–8 files, exact MIME-extension matching, `type=input`, prompt-scoped subfolder, validated response identity, and preserved order. Do not sort, deduplicate, truncate, or upload concurrently.

- [ ] **Step 5: Run Step 2 tests and verify GREEN, then commit**

```powershell
git add src/lib/media/outbound-image.ts src/lib/ai-providers/comfyui/h3-input-upload.ts tests/integration/security/outbound-image.security.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts
git commit -m "feat(video): upload owned H3 reference images"
```

---

### Task 5: Execute and preflight the new graph

**Files:**
- Modify: `src/lib/ai-providers/comfyui/h3.ts`
- Modify: `src/lib/ai-providers/comfyui/profile-requirements.ts`
- Modify: `tests/unit/ai-providers/comfyui/profile-requirements.test.ts`
- Modify: `tests/integration/provider/comfyui-h3-submission.contract.test.ts`

**Interfaces:**
- Consumes all previous tasks.
- Produces preflight → owned reads → ordered uploads → one `/prompt` for Ref while preserving non-Ref execution.

- [ ] **Step 1: Write failing submission/preflight tests**

Prove imageCount+audioCount uploads, a 15-second graph with frame 362 and MP 0.47/0.67, final H.264 fields, both conditioning reference collections, and one `/prompt`. Prove preflight happens before upload and rejects a missing T8 node, image/audio autogrow below 8/3, missing LoRA/upscaler model, incompatible dimension port, or invalid audio mux with zero uploads/submits. Prove frame/continuation make no reference-image upload.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run tests/unit/ai-providers/comfyui/profile-requirements.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts
```

- [ ] **Step 3: Expand production graph requirements**

Add `LoraLoaderBypassModelOnly.lora_name` and `MiniMaxH3LearnedLatentUpscaleT8Advanced.model_name` to existing UNET/CLIP/VAE/LoRA/VSR/attention requirement derivation. Missing model-like options become `COMFYUI_MODEL_MISSING`; other fixed options remain `COMFYUI_OPTION_MISSING`.

- [ ] **Step 4: Replace Ref execution preparation**

Resolve mode and exact shared policy before Prompt validation. For Ref, derive one runtime plan, build placeholders, complete local graph assertions and `/object_info` preflight, then read images through `outbound-image`, read audios through existing owned-audio logic, upload both under the same prompt id, rebuild with returned filenames, and POST once. Remove the old Ref URL path; keep external id, acceptance probe, poll/cancel, and node 168 result logic.

- [ ] **Step 5: Enforce both T8 conditioning contracts**

Require `LoadImage.image`, optional `LoadAudio.audio`, T8 CLIP/VAE/width/height/length inputs, image autogrow prefix/type/max 8, audio autogrow prefix/type/max 3 when used, learned-upscaler target MP, final resize dimensions, shared Prompt/frame/reference order, native-audio decode/mux, and final H.264 output. Image-only Ref may omit `LoadAudio` support, but never T8/image support.

- [ ] **Step 6: Run Step 2 tests and verify GREEN, then commit**

```powershell
git add src/lib/ai-providers/comfyui/h3.ts src/lib/ai-providers/comfyui/profile-requirements.ts tests/unit/ai-providers/comfyui/profile-requirements.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts
git commit -m "feat(video): execute the H3 Ref T8 workflow"
```

---

### Task 6: Remove stale contracts and verify the affected boundary

**Files:**
- Modify only H3 tests/imports proven stale by the searches below.

**Interfaces:**
- Produces zero production references to the old Ref graph/class, ambiguous duration API, or global H3 duration capability.

- [ ] **Step 1: Search stale paths**

```powershell
rg -n "h3-dual-stage-2mp\.json|MiniMaxH3ReferenceToVideo|resolveH3ContinuationDurationPlan|H3_DURATION_OPTIONS_SECONDS|H3_DURATION_MIN_SECONDS|H3_DURATION_MAX_SECONDS" src tests
```

Expected: zero production Ref-path hits; any test hit must describe intentionally rejected old behavior.

- [ ] **Step 2: Run all affected independent-oracle tests**

```powershell
npx vitest run tests/unit/video-generation/h3-duration.test.ts tests/unit/ai-registry/video-input-policy.test.ts tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts tests/unit/ai-providers/comfyui/h3-frame-dual-stage-profile.test.ts tests/unit/ai-providers/comfyui/h3-continuation-profile.test.ts tests/unit/ai-providers/comfyui/profile-requirements.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/contracts/project-production-prompt-profile-conformance.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts tests/integration/task/project-video-model-config.integration.test.ts tests/integration/security/outbound-image.security.test.ts
```

- [ ] **Step 3: Run static and catalog verification**

```powershell
npm run check:capability-catalog
npm run check:model-config-contract
npm run check:media-normalization
npm run typecheck
npm run lint -- src/lib/ai-registry src/lib/ai-providers/comfyui src/lib/video-generation src/lib/project-production-context.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/media/outbound-image.ts
```

- [ ] **Step 4: Re-run architecture routing and inspect Git state**

```powershell
npm run architecture:impact -- src/lib/ai-registry src/lib/ai-providers/comfyui src/lib/video-generation src/lib/project-production-context.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/media/outbound-image.ts
git diff --check
git status --short
git log -6 --oneline
```

Confirm one Ref graph, one policy resolver, output node 168, no unrelated changes, and no architecture-document edit.

- [ ] **Step 5: Run real-runtime acceptance when 8188 is available**

Generate 5-second 9:16, 10-second 21:9, 15-second 16:9, and if possible 15-second 9:21. Inspect each result:

```powershell
ffprobe -v error -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate -show_entries format=duration,size -of json output.mp4
```

Required evidence is H.264, yuv420p, 24/1, requested orientation, about 2MP area, native audio, aligned duration, and bounded size. If 8188 remains unavailable, report that exact effect/performance blind spot.
