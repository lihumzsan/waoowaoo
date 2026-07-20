# LTX2.3 KJ PromptRelay No-Subtitles Design

## Scope

Apply subtitle suppression only to `basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p`. Do not change Smart VBVR, Bernini, Goon, Wan, or any other ComfyUI workflow.

The goal is generation-time suppression of burned-in subtitles and readable dialogue text. This is not post-processing, cropping, masking, or OCR inpainting.

## Learned behavior from the reference workflow

The reference workflow uses two complementary controls:

1. A second Codex node detects dialogue, removes the literal transcript, and retains visible speaking behavior such as rhythmic lip movement, head motion, gaze, and gestures.
2. Both sampling stages use negative text conditioning containing concepts such as subtitles, captions, Chinese characters, text overlays, lower thirds, signage, and watermarks.

Its first stage also preserves dialogue through an audio latent. The KJ PromptRelay workflow has no equivalent audio path, so copying that stage would add cost and dependencies without preserving useful behavior.

## Chosen approach

Use an application-layer dual guard.

### Positive prompt guard

The existing GPT-5.5 KJ prompt enhancement request will explicitly require:

- no literal transcript or quoted dialogue in `enhanced_prompt`;
- no instructions to render subtitles, captions, dialogue text, or readable speech text;
- retention of visible speaking intent through mouth movement, facial motion, posture, gaze, and restrained gestures;
- preservation of `GLOBAL`, numbered `LOCAL` sections, model-selected `segment_frames`, and the application-appended `LENGTHS` line.

After GPT-5.5 returns, a deterministic KJ-only sanitizer will remove common quoted-dialogue forms and replace dialogue-bearing speech clauses with a neutral visible-speaking action. The same sanitizer will run on fallback prompts, so a model failure cannot reintroduce literal dialogue text.

The sanitizer must not alter PromptRelay section markers, segment order, `LENGTHS`, ordinary non-dialogue quoted object names, or prompts for any other workflow.

### Negative conditioning guard

The stored KJ graph currently sends PromptRelay positive conditioning through `ConditioningZeroOut` to create its negative branch. During KJ workflow resolution, the application will follow the repository's existing Smart VBVR pattern: convert that `ConditioningZeroOut` node in place into a locked `CLIPTextEncode`, reuse the PromptRelay node's existing DualCLIP connection, and fill it with a KJ-specific negative prompt. The existing connection from this node to `LTXVConditioning.negative` remains unchanged.

The negative prompt will focus on text artifacts:

- subtitles, captions, closed captions, burned-in subtitles;
- lower thirds, text overlays, dialogue text, speech text;
- Chinese characters, English letters, glyph-like marks;
- bottom-center or white subtitle lines;
- signage, logos, watermarks, blurry or distorted text, and artifacts around text.

The converted application-owned node and prompt are not exposed as user-editable controls.

## Data flow

1. The panel prompt and source-frame context enter the existing KJ GPT-5.5 enhancement path.
2. GPT-5.5 produces `GLOBAL`, three to five content-aware `LOCAL` sections, and non-equal `segment_frames`.
3. The KJ-only positive sanitizer removes literal speech text while retaining visual speaking action.
4. Existing validation checks PromptRelay structure, segment count, integer frame counts, total frame budget, continuity, and camera safety.
5. The application appends canonical `LENGTHS` values.
6. KJ workflow resolution converts the zeroed negative branch to locked `CLIPTextEncode` conditioning and preserves the PromptRelay positive conditioning.
7. ComfyUI receives a 720p KJ graph with both positive and negative subtitle suppression.

## Failure handling

- Missing or invalid `segment_frames`: use the existing deterministic non-equal fallback, after KJ dialogue-text sanitization.
- GPT failure or malformed JSON: sanitize the fallback prompt before appending `LENGTHS`.
- Missing the expected KJ PromptRelay CLIP source or zeroed-negative node: fail workflow resolution with a specific KJ negative-conditioning configuration error instead of silently running with zero negative conditioning.
- Sanitization removes all useful action text from a LOCAL section: replace only that section's content with a neutral visible-speaking motion while preserving its section marker and frame allocation.

## Testing

Add focused regression coverage for:

1. A KJ GPT response containing Chinese quoted dialogue: the final prompt keeps speaking/lip motion, removes the quoted transcript, and retains the same non-equal `LENGTHS`.
2. English dialogue introduced through `says`, `speaks`, or quoted text: no literal transcript reaches PromptRelay.
3. GPT failure and invalid-frame fallbacks: no literal transcript survives.
4. KJ workflow resolution: the negative branch is a real `CLIPTextEncode` using the existing CLIP, includes the required text-artifact concepts, and is connected to `LTXVConditioning.negative`.
5. Isolation: another LTX2.3 workflow retains its original negative-conditioning behavior.
6. Existing KJ 9-second, 25 fps, 720p, motion-strength, content-aware timing, and workflow-lock tests remain green.

## Live verification

Use a panel whose action visibly contains speaking or dialogue context. Generate it with the KJ card on the configured ComfyUI 112 endpoint, then verify:

- the task completes at 720p with the selected duration and 25 fps;
- logs show `codex::gpt-5.5` and no literal transcript in the final KJ PromptRelay positive prompt;
- the resolved graph contains the application-owned negative text conditioning;
- sampled frames from the completed video contain no burned-in subtitle line or readable dialogue text.

## Success criteria

The feature is complete when KJ alone has both guards, all focused tests and type checking pass, code review has no blocking issue, and one live 112 generation completes without visible subtitles or readable dialogue text.
