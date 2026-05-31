# LTX2.3 VBVR Prompt Bridge Design

## Goal

Add a bridge in the existing LTX2.3 video prompt enhancement path so automatically generated panel prompts are rewritten into the prompt style used by LTX2.3 + VBVR / PromptRelay workflows before they are submitted to ComfyUI.

The bridge must not overwrite prompts that the user has manually edited.

## External Pattern Summary

RunningHub LTX2.3 / VBVR examples and PromptRelay workflows use structured prompt composition instead of one dense paragraph.

The common pattern is:

- `GLOBAL:` anchors the source frame: visible subject count, identity, room, lighting, composition, and continuity constraints.
- `LOCAL:` describes continuous visible action in a single shot: posture change, expression, lip motion, hand motion, and allowed camera motion.
- Longer PromptRelay workflows may split the local action into `LOCAL 1:`, `LOCAL 2:`, `LOCAL 3:` and so on. Each segment advances one small beat and must avoid scene cuts, time skips, new people, new rooms, unrelated props, or camera angle jumps.
- Duration and frame segmentation remain workflow concerns. The prompt text should provide stable semantic sections that ComfyUI can inject into `global_prompt` and `local_prompts`.

References:

- RunningHub LTX2.3 page: https://www.runninghub.ai/post/2052419444986654721/?inviteCode=rh-v1121LTX2.3
- ComfyUI PromptRelay: https://github.com/kijai/ComfyUI-PromptRelay

## Current Project Context

The existing video path already has the right bridge point:

1. `src/app/api/novel-promotion/[projectId]/generate-video/route.ts` resolves the LTX2.3 workflow route and submits a `VIDEO_PANEL` task.
2. `src/lib/workers/video.worker.ts` prepares panel video generation and calls LTX2.3 prompt enhancement.
3. `src/lib/video-duration/ltx23-prompt-enhance.ts` calls an LLM to rewrite the panel prompt, validates the result, then appends safety and continuity constraints.
4. `src/lib/generators/comfyui-video.ts` submits the final prompt to ComfyUI.
5. `src/lib/providers/comfyui/workflow-registry.ts` already parses `GLOBAL:` and `LOCAL:` sections and injects them into PromptRelay-compatible workflow nodes.

Because the bridge already exists, implementation should extend `ltx23-prompt-enhance.ts` and the existing prompt template instead of creating a second prompt generation pipeline.

## Requirements

1. Preserve the current generation path and ComfyUI submission path.
2. Do not overwrite or LLM-rewrite user-edited video prompts.
3. For automatically generated LTX2.3 prompts, guide the LLM to produce VBVR / PromptRelay-style structured output.
4. Validate the LLM output before passing it downstream.
5. Keep existing fallbacks: invalid, off-topic, unsafe, or unanchored LLM output must fall back to the original prompt plus safety constraints.
6. Keep exact dialogue preservation for linked voice lines.
7. Keep source-frame continuity constraints, especially no new people, no new locations, no subtitles, and no invented camera travel.

## Prompt Policy Mapping

### `stable_single_image`

Use for Smart VBVR single-image workflows.

Expected output:

```text
GLOBAL: Fixed source-frame subjects, room, lighting, composition, and identity anchors.
LOCAL: One continuous single-shot action with restrained expression, lip motion, hand motion, and only explicitly requested camera movement.
```

If the original prompt does not request camera travel, `LOCAL:` must use a locked-off camera.

### `micro_detail`

Use the same `GLOBAL:` plus `LOCAL:` structure, but restrict `LOCAL:` to micro motion:

- eyes and gaze
- blinking
- mouth or lip movement
- breath
- subtle facial expression
- small finger or hand motion

No pan, tracking, orbit, dolly, zoom, or large body movement should be introduced.

### `large_motion_single_image`

Use `GLOBAL:` plus four local segments because the workflow already has four PromptRelay stages.

Expected output:

```text
GLOBAL: Fixed source-frame subjects, environment, lighting, and identity anchors.
LOCAL 1: Start from the source frame and prepare the movement.
LOCAL 2: Continue the movement without cuts.
LOCAL 3: Reach the largest continuous movement beat.
LOCAL 4: Settle into the final motion state while preserving identity and scene.
```

Each segment must remain in one continuous shot and must not add new subjects or scene changes.

### `long_promptrelay`

Use `GLOBAL:` plus multiple `LOCAL n:` sections. The segment count should match the workflow profile when available:

- `damaicha-long-video-promptrelay`: five local segments.
- AIO fallback workflows with PromptRelay controls: three local segments.
- Other long PromptRelay workflows: at least three local segments.

Each local segment should represent a small time progression, not a new scene.

### `first_last_frame`

Keep the current first-to-last-frame bridge behavior. Structured sections may be used, but multi-segment PromptRelay is not required. The prompt must emphasize natural motion from the starting frame to the ending frame and must not add unrequested subjects or locations.

## Architecture

### Prompt Template

Update both prompt templates:

- `lib/prompts/video/ltx23_video_prompt_enhance.en.txt`
- `lib/prompts/video/ltx23_video_prompt_enhance.zh.txt`

The templates should explain:

- the structured VBVR / PromptRelay format,
- when to use `GLOBAL:` and `LOCAL:`,
- when to use numbered `LOCAL n:` segments,
- that output still returns JSON only,
- that `enhanced_prompt` must be final production prompt text.

The template should continue using the current variables:

- `original_prompt`
- `panel_context`
- `character_context`
- `audio_context`
- `generation_context`

No catalog changes are needed because the prompt id and variables stay the same.

### TypeScript Bridge

Extend `src/lib/video-duration/ltx23-prompt-enhance.ts`.

Add small helper functions for structured prompt validation:

- detect whether a prompt contains `GLOBAL:`,
- detect whether it contains `LOCAL:` or numbered `LOCAL n:`,
- count numbered local sections,
- determine whether the current `Ltx23PromptPolicy` requires structured output,
- determine the minimum local segment count for long or large-motion policies.

Validation rules:

- `stable_single_image`, `micro_detail`, `large_motion_single_image`, and `long_promptrelay` require `GLOBAL:` plus `LOCAL:` or `LOCAL n:`.
- `large_motion_single_image` requires at least four local sections when the LLM emits numbered sections.
- `long_promptrelay` requires at least three local sections when the LLM emits numbered sections.
- `first_last_frame` does not require structured output.
- Empty, unanchored, off-topic, or unrequested orbit output keeps the existing fallback behavior.

If a policy requires structure and the LLM output is missing structure, return:

- original prompt,
- `enhanced: false`,
- existing dialogue and safety constraints appended.

### ComfyUI PromptRelay Extraction

Update `src/lib/providers/comfyui/workflow-registry.ts` only if needed so `extractPromptRelaySection(prompt, 'LOCAL')` returns all numbered local sections, not only the first `LOCAL 1:` block.

Expected behavior:

```text
GLOBAL: same office and visible doctor
LOCAL 1: doctor inhales and raises his eyes
LOCAL 2: doctor speaks the first phrase
LOCAL 3: doctor pauses and keeps eye contact
```

For `local_prompts`, the extracted local text should include all local segments in order. The existing segment builder may then repeat or stage them according to workflow segment count.

## Data Flow

1. Panel video task receives the saved automatic video prompt.
2. If the model is not LTX2.3, return the prompt unchanged.
3. If `videoPromptEditedByUser` is true, skip LLM rewriting and append safety constraints only.
4. Resolve the LTX2.3 workflow prompt policy from the selected model key.
5. Build the LLM prompt with VBVR / PromptRelay instructions.
6. Parse JSON response.
7. Validate structure, anchoring, dialogue, and unsafe camera additions.
8. Append exact dialogue and source-frame continuity constraints.
9. Submit final prompt through the existing ComfyUI generator.
10. `workflow-registry.ts` injects `GLOBAL:` into PromptRelay `global_prompt` and `LOCAL:` / `LOCAL n:` content into `local_prompts`.

## Error Handling

The bridge should fail closed:

- JSON parse failure: fallback to original prompt plus safety constraints.
- missing `enhanced_prompt`: fallback.
- missing required `GLOBAL:` / `LOCAL:` structure: fallback.
- off-topic prompt: fallback.
- unrequested orbit or camera travel: fallback.
- unavailable text model: keep current behavior and return original prompt without LLM enhancement.

Fallbacks must not block video generation.

## Testing

### Unit Tests

Update `tests/unit/video/ltx23-prompt-enhance.test.ts`:

- user-edited prompt still skips `executeAiTextStep`,
- Smart VBVR enhancement request includes structured `GLOBAL:` / `LOCAL:` guidance,
- Smart VBVR final prompt preserves `GLOBAL:` and `LOCAL:`,
- Smart VBVR missing structure falls back to original prompt,
- micro-detail policy asks for micro-motion-only structured output,
- large-motion policy accepts `LOCAL 1:` through `LOCAL 4:`,
- long PromptRelay policy accepts multiple numbered `LOCAL n:` sections,
- invalid or off-topic structured output still falls back.

Update `tests/unit/providers/comfyui-workflow-registry.test.ts`:

- numbered local sections are extracted together for PromptRelay local prompt injection,
- global section extraction remains unchanged.

### Verification Commands

Targeted verification:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/video/ltx23-prompt-enhance.test.ts tests/unit/providers/comfyui-workflow-registry.test.ts
```

Broader LTX2.3 regression verification:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/providers/comfyui/ltx23-workflow-router.test.ts tests/unit/generators/comfyui-video.test.ts tests/unit/worker/video-worker.test.ts
```

## Non-Goals

- Do not add a new UI control for this bridge.
- Do not add a new database column.
- Do not change the ComfyUI task payload contract.
- Do not alter user-edited prompts beyond existing safety constraint appending.
- Do not replace workflow routing.
- Do not generate videos during unit verification.

## Open Decisions Resolved

- User-edited prompts are not overwritten.
- Implementation uses the existing bridge rather than a separate prompt pipeline.
- Structured output is required for automatic VBVR / PromptRelay prompt enhancement.
