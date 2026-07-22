# Motion-Aware AI Video Seam Bridge Design

## Status

Approved product and technical direction for repairing the standalone video-tools AI seam mode. This specification replaces the current two-endpoint AI bridge behavior but leaves direct concatenation unchanged.

## Goal

Make AI seam mode produce a visibly continuous transition between two uploaded videos instead of a mostly static morph between isolated still images. The repaired path must preserve the incoming and outgoing motion direction, keep source geometry and playback speed stable, retain source audio, expose the applied media decisions in the task result, and fail explicitly when the inputs or remote ComfyUI installation cannot satisfy the quality contract.

Success means the final MP4:

- enters the transition with motion consistent with the retained tail of Video 1;
- exits with motion consistent with the retained head of Video 2;
- contains the exact retained endpoint frames from both source videos;
- does not stretch either source to a fixed `1280x736` canvas;
- plays at Video 1's source FPS and preserves compatible Video 2 timing;
- preserves available source audio; when both inputs contain audio, silence appears only in the newly generated central interval;
- remains diagnosable from its task result without inspecting a resolved workflow dump.

## Current failure and root cause

The current AI seam path extracts only one retained frame from each input, sends those two still images to the Goon first/last-frame LTX workflow, and concatenates the generated interior between the source videos. A stronger prompt cannot recover motion that was never supplied to the model.

The resolved generation graph also fixes the bridge to `1280x736` at `24` FPS. Final composition then adopts Video 1's FPS and uses `nearest-exact` image matching, so non-matching source media can be stretched, duplicated, or played at the wrong speed. The bridge composition workflow has no audio input or output even though the product describes picture-and-sound concatenation. Existing tests assert graph wiring but do not validate motion, media metadata, or audio on real MP4 output.

The repair therefore changes the conditioning and composition contracts. Prompt tuning alone is not an accepted fix.

## Scope

This change covers only the authenticated standalone `/workspace/video-tools` seam-concat tool when `mode` is `ai_bridge`:

- source-media probing and compatibility checks;
- four motion-anchor extraction;
- four-anchor LTX conditioning;
- source-derived generation geometry and FPS;
- deterministic picture and audio composition;
- AI-mode duration default, progress, errors, and result diagnostics;
- unit, contract, and real-media verification for this path.

Direct mode remains the selected default and retains its current behavior. Existing trim semantics remain exact:

- Video 1 removes `trimEndFrames` from its tail;
- Video 2 removes `trimStartFrames` from its head.

The following are outside this change:

- novel-promotion `continuityRelay` data or generation behavior;
- optical-flow, RIFE, FILM, or another new interpolation model;
- a generic workflow picker or advanced encoding controls;
- database schema changes;
- automatic fallback from AI mode to direct mode or the old two-frame bridge.

## Considered approaches

### Metadata and audio repair only

Correct the fixed resolution, FPS, scaling, and missing audio while keeping two endpoint images. This is lower risk but still gives the model no evidence of incoming or outgoing velocity. It cannot address the main visual failure.

### Four motion anchors with deterministic composition

Condition the LTX graph with two frames from each side of the seam, place them at explicit time indices, and replace those four positions with the exact source frames during composition. This retains the existing model family while giving it the missing motion evidence. This is the selected approach.

### Add optical flow or a new interpolation model

An interpolation model can smooth small changes but introduces a new deployment dependency and can deform subjects when the two shots differ semantically. It remains a future option only if four-anchor LTX cannot meet the real-media acceptance bar.

## Architecture and ownership

The AI branch remains an application-orchestrated pipeline so each boundary is observable:

1. The worker resolves the two owned storage objects and invokes a media-probe workflow for each input.
2. Application code validates the returned metadata and calculates all source and generated frame indices.
3. An anchor workflow extracts the two calculated PNG frames from each source and returns four distinct named outputs.
4. The ComfyUI client preflights the remote four-anchor node contract, uploads the four anchors, resolves the LTX workflow with explicit indices, and waits for the generated bridge.
5. A dedicated composition workflow combines exact source ranges, selected AI frame ranges, source audio, and calculated silence.
6. The worker persists the MP4 and returns the applied probe, generation, composition, and audio metadata.

Ownership boundaries are:

- `src/lib/video-tools/` owns pure validation, frame math, compatibility rules, and result types.
- `src/lib/providers/comfyui/workflow-registry.ts` owns graph injection and resolved-graph preflight.
- `src/lib/providers/comfyui/client.ts` owns upload, multi-output collection, remote node-capability checks, execution, and output discovery.
- `src/lib/workers/handlers/video-seam-concat.ts` owns orchestration, progress, persistence, and final task metadata.
- the video-tools page owns mode selection, duration selection, precise error presentation, and result diagnostics.

No browser request calls ComfyUI directly or receives its base URL.

## Media probe contract

Each input probe produces a `SeamProbeResult` with:

- `width` and `height` of the decoded source frames;
- positive finite `fps` from the decoded video stream;
- integer `frameCount` and derived `durationSeconds`;
- `hasAudio` for a decodable audio stream.

After frame math succeeds, each anchor extraction produces a `SeamAnchorResult` containing the requested zero-based indices and exactly two distinct PNG outputs. The client associates outputs by stable node identity and role (`pre`/`endpoint` or `endpoint`/`post`), not by object iteration order or whichever saved image appears first.

Probe values are authoritative for server-side validation and composition. Browser `<video>` metadata is presentation-only and must not be trusted for FPS, frame count, or audio presence.

The probe fails if a source has no decodable video stream or reports non-finite metadata. Anchor extraction fails if it cannot provide every requested frame. The worker must not substitute a nearby frame without recording and validating the exact index.

## Compatibility policy

Video 1 defines the final output canvas and FPS.

Both decoded dimensions must be positive even integers because the final `yuv420p` encoder cannot represent odd-sized frames without changing the canvas. Unsupported dimensions fail with `VIDEO_SEAM_DIMENSIONS_UNSUPPORTED` instead of being silently rounded.

Aspect-ratio compatibility uses:

```text
aspectDelta = abs((width2 / height2) - (width1 / height1)) / (width1 / height1)
```

An `aspectDelta` of at most `0.01` is compatible. Video 2 is scaled to cover Video 1's canvas with Lanczos sampling and a centered crop, preserving geometry. A larger delta fails with `VIDEO_SEAM_ASPECT_RATIO_MISMATCH`; the system does not stretch or silently letterbox it.

FPS compatibility uses:

```text
fpsDelta = abs(fps2 - fps1) / fps1
```

An `fpsDelta` of at most `0.002` is compatible, which admits nominal pairs such as `23.976/24` and `29.97/30`. The final output uses Video 1's exact probed FPS. A larger delta fails with `VIDEO_SEAM_FPS_MISMATCH`; the system does not duplicate or drop a material number of source frames without telling the user.

The LTX canvas is derived from Video 1 instead of using a fixed landscape shape. Source content is aspect-preservingly downscaled only when its long edge exceeds `1280`, then reflection-padded to the next multiple of `32` on each axis. After generation, padding is removed and the bridge is Lanczos-scaled to Video 1's exact output dimensions. This supports portrait and landscape input without geometric stretching while keeping the current LTX pixel budget bounded.

All four anchors use the same Video 1 canvas normalization, model padding, and inverse crop. Video 2 is normalized to Video 1 before its endpoint and post-anchor are sent to LTX, so the model and final composer see the same framing contract.

The LTX conditioning FPS and legal frame-count calculation use Video 1's probed FPS. The resolved graph must no longer overwrite it with `24`.

## Exact source anchor math

Let:

- `A = probe1.frameCount`;
- `B = probe2.frameCount`;
- `aEnd = A - trimEndFrames - 1`, the last retained Video 1 index;
- `bStart = trimStartFrames`, the first retained Video 2 index;
- `outputFps = probe1.fps`.

The motion handle is approximately a quarter second and is deterministic:

```text
handleFrames = clamp(round(outputFps * 0.25), 2, 8)
```

The four source anchors are:

```text
A pre-anchor = aEnd - handleFrames
A endpoint   = aEnd
B endpoint   = bStart
B post-anchor = bStart + handleFrames
```

All indices are zero-based. The request fails with `VIDEO_SEAM_CONTEXT_TOO_SHORT` unless:

```text
aEnd - handleFrames >= 0
bStart + handleFrames < B
```

This rule is deliberately fail-closed. Reducing the handle, ignoring trim values, or duplicating an endpoint would hide the absence of real motion context.

## Four-anchor LTX conditioning

For requested duration `durationSeconds`, the generated bridge uses the LTX-compatible frame count:

```text
generatedFrameCount = 1 + 8 * round((durationSeconds * outputFps) / 8)
```

It must also satisfy `generatedFrameCount >= 2 * handleFrames + 3`. The four images are injected into both LTX image-conditioning stages at these exact generated indices:

```text
0                                      = A pre-anchor
handleFrames                           = A endpoint
generatedFrameCount - handleFrames - 1 = B endpoint
generatedFrameCount - 1                = B post-anchor
```

Each conditioning stage sets `num_images` to `4`, uses the same image order and indices, and keeps anchor strength at `1.0`. The positive prompt describes continuous evolution but is not responsible for endpoint identity or motion direction; those come from the anchors.

Before task execution, the client inspects the configured ComfyUI node contract for `LTXVImgToVideoInplaceKJ` and validates the resolved prompt. If the installed node version cannot accept four image slots and explicit indices, the task fails with `VIDEO_SEAM_FOUR_ANCHOR_UNSUPPORTED`. There is no silent fallback to the current two-frame path.

AI mode offers `4`, `6`, and `8` seconds and defaults to `4`. `durationSeconds` is the total four-anchor generation span; because both motion handles replace source frames, only `centralSilenceSeconds` is added to the final output duration. The duration control explains this distinction and the completed result shows the exact added duration. Direct mode remains the page default, so opening the tool does not unexpectedly add AI cost or latency.

## Deterministic video composition

The generated first and last images are conditioning boundaries, not trusted final endpoints. Composition replaces all four anchor positions with source frames and uses AI only between them.

The exact output order is:

1. original Video 1 frames `0..A pre-anchor`;
2. generated frames `1..handleFrames - 1`;
3. original Video 1 frame `A endpoint`;
4. generated frames `handleFrames + 1..generatedFrameCount - handleFrames - 2`;
5. original Video 2 frame `B endpoint`;
6. generated frames `generatedFrameCount - handleFrames..generatedFrameCount - 2`;
7. original Video 2 frames `B post-anchor..B - 1`.

This preserves the full retained frame count of both sources: the incoming and outgoing generated handles replace source visuals over the same number of frames, while only the central generated range adds duration. No boundary frame is duplicated.

The final frame-count identity is:

```text
centralFrameCount = generatedFrameCount - 2 * handleFrames - 2
retainedVideo1FrameCount = aEnd + 1
retainedVideo2FrameCount = B - bStart
outputFrameCount = retainedVideo1FrameCount + centralFrameCount + retainedVideo2FrameCount
```

All image merges use Lanczos sampling. `nearest-exact` is removed from the AI composition path. The final encoder uses Video 1's exact dimensions and FPS, H.264 MP4, and `yuv420p`. Its target bitrate in Mbit/s is:

```text
targetBitrateMbps = clamp(ceil(width1 * height1 * outputFps * 0.07 / 1_000_000), 10, 40)
```

This retains the current 10 Mbit/s floor for ordinary 720p/1080p input while avoiding the same low ceiling for higher-resolution output.

## Audio composition

Audio follows the source timeline rather than the generated bridge audio:

- Video 1 audio is retained through `A endpoint`, including the incoming generated visual handle.
- Silence is inserted only for the central generated range between the two source endpoints.
- Video 2 audio begins at `B endpoint`, including the outgoing generated visual handle.

The central silence length is frame-derived:

```text
centralSilenceSeconds = centralFrameCount / outputFps
```

Video 1 audio is trimmed at `(aEnd + 1) / probe1.fps`. Video 2 audio starts at `bStart / probe2.fps`. When the compatible source FPS values are not equal, Video 2 audio is pitch-preservingly time-stretched with `tempoFactor = outputFps / probe2.fps` so it remains synchronized with Video 2 frames played at the output FPS.

When only one source has audio, an exact-length silent segment is synthesized for the source segment that has no audio so the remaining audio stays aligned. When both sources have no audio, the result omits the audio track. The final audio and video durations must differ by no more than one output frame.

The LTX workflow's generated audio is ignored for final composition because it cannot preserve the source sound at the seam.

## Progress, result, and error behavior

AI tasks report truthful coarse stages without inventing a percentage inside a remote ComfyUI run:

1. preparing inputs;
2. probing media and extracting anchors;
3. generating the motion bridge;
4. composing picture and sound;
5. persisting output.

The completed task result retains the existing filenames and trim values and adds:

- applied `mode`;
- both probe summaries: width, height, FPS, frame count, duration, and audio presence;
- output width, height, and FPS;
- generation canvas, generated frame count, requested duration, and `handleFrames`;
- four source and generated anchor indices;
- `centralFrameCount` and `centralSilenceSeconds`;
- Video 2 audio `tempoFactor`;
- audio policy (`both`, `video1_only`, `video2_only`, or `silent`).

The page renders concise compatibility and capability errors and preserves both uploaded inputs for retry. A failed AI run is never presented as direct-mode success. Existing queued/running task restoration continues to use the shared task store; no new persistence table is added.

Stable error codes for the new quality boundaries are:

- `VIDEO_SEAM_MEDIA_PROBE_FAILED` for undecodable or incomplete source metadata;
- `VIDEO_SEAM_DIMENSIONS_UNSUPPORTED` for non-positive or odd decoded dimensions;
- `VIDEO_SEAM_ASPECT_RATIO_MISMATCH` for incompatible source geometry;
- `VIDEO_SEAM_FPS_MISMATCH` for incompatible playback rates;
- `VIDEO_SEAM_CONTEXT_TOO_SHORT` for missing retained motion handles;
- `VIDEO_SEAM_ANCHOR_OUTPUT_MISSING` for incomplete or unordered probe images;
- `VIDEO_SEAM_FOUR_ANCHOR_UNSUPPORTED` for an incompatible remote LTX node;
- `VIDEO_SEAM_GENERATED_RANGE_INVALID` for a bridge that cannot contain all four ordered indices;
- `VIDEO_SEAM_AUDIO_COMPOSE_FAILED` for audio trim, time-stretch, silence, or merge failure.

Errors from ComfyUI upload, queueing, execution, output discovery, and persistence keep their existing lower-level codes. The UI maps only the stable seam codes to tailored guidance and presents a generic retryable processing failure for other provider details.

## Testing strategy

### Pure frame and compatibility tests

- handle calculation at fractional and integer FPS;
- exact source indices for both trim fields;
- insufficient pre/post context and trim-at-boundary rejection;
- LTX legal frame count and four strictly increasing generated indices;
- central frame and silence duration math;
- Video 2 audio tempo-factor and final audio-duration math;
- aspect-ratio and FPS values immediately inside and outside both thresholds;
- portrait, landscape, native-size, downscaled, and padded generation canvases.

### Workflow and client contract tests

- probe workflow returns two distinct named anchors plus complete metadata per input;
- Goon workflow injects four images and four indices into both conditioning stages;
- resolved graph uses source-derived dimensions and Video 1 FPS;
- remote node preflight fails closed when four-image inputs are unavailable;
- client collects every expected image/video output rather than the first arbitrary output;
- composition selects the exact seven frame ranges in order;
- image merges use Lanczos and the final graph includes synchronized audio;
- no test uses identical base64 content for all four anchors.

### Worker, API, and UI tests

- AI orchestration forwards probe metadata, anchors, trim values, generation settings, and composition values;
- unsupported aspect ratio, FPS, short context, remote node contract, and missing output errors remain distinguishable;
- completed result includes all applied diagnostics and `mode: ai_bridge`;
- duration defaults to `4` while direct remains the selected default;
- active tasks cannot be resubmitted and polling continues until a terminal result;
- direct-mode regression tests remain unchanged and passing.

### Real-media acceptance

Run a real ComfyUI canary with two representative MP4s that contain motion and audio. Inspect the persisted application output, not only ComfyUI queue completion.

Automated media checks must confirm:

- output dimensions and FPS equal Video 1's probed values;
- an audio track exists when either input contains audio;
- Video 1 and Video 2 audio remain present on their respective sides, with silence limited to the calculated central range;
- each of the four normalized anchor positions has SSIM of at least `0.99` against its expected source frame after encode/decode normalization;
- the AI bridge has no run of six or more nearly identical consecutive frames, using consecutive-frame SSIM greater than `0.998` as the static-hold signal;
- output duration equals `(retainedVideo1FrameCount + retainedVideo2FrameCount + centralFrameCount) / outputFps`, within one output frame.

Visual playback review must additionally reject a visible jump at either handle boundary, geometric stretching, a speed discontinuity, a frozen endpoint, or an audio cut outside the intended central silence. These checks are acceptance criteria, not optional observations.

## Rollout and rollback

The implementation replaces only the explicit AI branch after targeted tests and the real-media canary pass. Direct mode remains available throughout rollout. Existing completed outputs remain valid because task result additions are backward-compatible JSON fields.

Rollback restores the previous AI workflow and handler path without a data migration. If the remote four-anchor node contract is unavailable, AI mode reports the capability error and direct mode remains usable; the application does not submit an unverified two-anchor graph.
