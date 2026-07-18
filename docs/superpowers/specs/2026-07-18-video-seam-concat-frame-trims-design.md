# Video Seam Concat Frame Trims Design

## Goal

Add two exact frame-count controls to the existing standalone seam-concat tool:

- Video 1 removes `trimEndFrames` frames from its tail; default `0`.
- Video 2 removes `trimStartFrames` frames from its head; default `1`.

The output is the retained Video 1 frames followed by the retained Video 2 frames. Matching audio is trimmed at the same boundaries.

## User experience

Each upload card shows one non-negative integer field below its video preview. Video 1 labels it “去掉尾部帧数”; Video 2 labels it “去掉头部帧数”. The fields remain visible before upload, use step `1`, and are disabled while a task is active. Replacing or removing a file does not reset the chosen value.

The page submits both values with their corresponding input objects. The optimistic task payload and final result retain the values so recent runs are inspectable. Existing callers that omit the fields keep the old behavior through server defaults `0` and `1`.

## Validation

Both controls must be finite integers from `0` through `100000`. The browser disables submission for invalid values and the server independently rejects invalid payloads. If a trim removes every frame, the ComfyUI graph produces an empty retained frame batch and rejects the task instead of silently changing the requested value.

## Workflow contract

The fixed ComfyUI graph continues loading Video 1 at node `1`, Video 2 at node `2`, and writing NVENC H.264 MP4 at Video 1 FPS with `yuv420p` and 10 Mbit/s.

For each input, `GetVideoComponents` exposes images, audio, and source FPS. `GetImageSize.batch_size` supplies the exact source frame count. `ComfyMathExpression` calculates retained frame counts. `ImageFromBatch` performs exact visual slicing. Audio boundaries are calculated from frame counts divided by each source video's FPS and applied through `TrimAudioDuration`. The two retained frame batches and audio segments are then concatenated.

The application injects the two trim counts into the fixed seam-concat graph through `ComfyUiWorkflowInject.videoTrimFrames`. No generic workflow UI or encoding controls are added.

## Data flow

1. The page sends `input1.trimEndFrames` and `input2.trimStartFrames`.
2. `parseVideoSeamConcatSubmission` normalizes and validates them, using defaults for omitted legacy fields.
3. The task payload carries both values to the video worker.
4. The worker validates legacy or current task payloads and forwards the values to `runComfyUiVideoSeamConcatWorkflow`.
5. The ComfyUI client resolves the fixed graph with the uploaded filenames and trim tuple.
6. The result includes both applied values alongside the existing video metadata.

## Testing

- Parser tests cover defaults, custom values, fractions, negatives, and the maximum.
- UI-state tests cover submission enablement for valid and invalid counts.
- Worker tests verify ordered trim forwarding and result metadata.
- Workflow-registry tests verify injected node values and exact frame/audio slicing connections.
- Client tests verify custom trim counts reach the submitted ComfyUI graph.
- Typecheck, targeted Vitest suites, JSON parsing, and diff checks complete verification.

## Scope

No database migration, workflow picker, transition controls, encoding controls, batch mode, or unrelated refactor.
