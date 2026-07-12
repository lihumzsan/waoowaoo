# Goon Explicit Final-Frame Index Design

## Problem

The Goon workflow injects the last image at pixel-frame index `-1`. The installed remote KJNodes runtime accepts the value but does not apply the final-frame conditioning. A controlled generation using the same images and workflow reaches the target frame when the index is changed to the explicit final pixel-frame number.

## Decision

Calculate the canonical Goon frame count from normalized duration and fixed 24 fps using the workflow formula `1 + 8 * round(duration * fps / 8)`. Inject `frameCount - 1` into `num_images.index_2` for both first-stage and second-stage `LTXVImgToVideoInplaceKJ` nodes.

This is preferred over editing the bundled JSON to a fixed number because duration is configurable, and preferred over post-production frame replacement because it preserves a model-generated transition into the target frame.

## Safety

- Keep first-frame index `0` and both conditioning strengths unchanged.
- Apply the override only to the canonical Goon workflow.
- Derive the index from the same normalized duration and fps values written into the workflow.
- Cover all supported durations with unit tests and verify through a real remote generation.
