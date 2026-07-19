# LTX2.3 Multi-shot PromptRelay 720p Design

## Goal

Add the supplied LTX2.3 single-image multi-shot PromptRelay workflow as a selectable ComfyUI video model. The workflow must render at the existing LTX 720p envelope, accept project-generated structured prompts, and avoid depending on the ComfyUI host's local Codex executable.

## Architecture

The supplied UI workflow is bundled as a new `basevideo/ltx23-profiles` asset and registered as an eighth LTX2.3 profile. It remains a manually selected profile so the existing automatic router does not unexpectedly switch existing users to it.

At resolve time, the project replaces the `PromptRelayEncode` node's connected `global_prompt` and `local_prompts` inputs with values derived from the project's enhanced prompt. This disconnects the `RH_CODEX_NODE`, regex, and preview chain; normal reachability pruning removes those nodes before the API graph is submitted to ComfyUI.

`LENGTHS` accepts comma-separated pixel-frame counts. Valid counts are normalized to the requested total frame count with largest-remainder allocation; absent or invalid values fall back to an even split. The workflow's image resize node keeps the requested aspect ratio, longest side 1280, and 8-pixel alignment, producing 1280x720 for 16:9 and 720x1280 for 9:16.

## Product surface

- Model label: `ComfyUI · LTX2.3 多镜头精准 PromptRelay 720p`
- Generation mode: normal image-to-video
- Duration options: 4, 5, 6, 8, 10, 12, 16, 20 seconds
- Default duration: 19.56 seconds
- Frame rate: fixed 25 FPS
- Resolution: fixed 720p
- Reference images: one source image
- Selection mode: manual unless explicitly chosen by the user

## Error handling

Malformed or count-mismatched `LENGTHS` does not fail submission; it falls back to equal segments. Missing workflow files continue to use the registry's existing `COMFYUI_WORKFLOW_NOT_FOUND` error. The resolved graph must contain neither `RH_CODEX_NODE` nor machine-specific Codex paths.

## Testing

- Profile tests cover registration, label, timing, prompt policy, and single-image behavior.
- Registry tests cover direct prompt locking, precise and normalized `LENGTHS`, 720p resize controls, frame count, image injection, output presence, and pruning of the Codex automation chain.
- User-model API tests cover automatic appearance in the model selector.
- Capability-catalog checks cover fixed 25 FPS and 720p.
- Targeted tests, typecheck, catalog guards, and a resolved-workflow sanity script must all pass.
