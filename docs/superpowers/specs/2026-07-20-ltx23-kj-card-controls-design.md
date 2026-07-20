# LTX2.3 KJ Card Controls Design

The KJ PromptRelay workflow must behave like Bernini in the panel card while preserving its fixed 720p/25 FPS runtime contract.

Duration uses the panel's computed recommendation as the selected default and displays it as the recommended option. The KJ capability list remains the broad LTX list, so manual alternatives are still available; runtime capability validation continues to proxy arbitrary recommended seconds to the next supported catalog duration without changing the exact generated duration.

Motion strength uses the existing Bernini UI vocabulary and values `1`, `2`, and `3`, defaulting to `1`. Because KJ's image guide accepts a `0..1` source-image strength rather than Bernini's LoRA scale, the adapter maps motion strength inversely: `1 -> 1.0`, `2 -> 0.85`, `3 -> 0.70`. This preserves the current stable default and progressively relaxes source-image anchoring for stronger motion. The selected level is also included in the central Codex prompt-enhancement context.

The central project prompt enhancer remains authoritative. For this workflow it receives the exact duration, 25 FPS, continuity constraints, and motion strength, and asks the configured Codex model for `GLOBAL` plus exactly 3, 4, or 5 numbered `LOCAL` stages according to duration. KJ output rejects `LENGTHS:` overrides and PromptRelay evenly allocates the target frame count. Final prompts are revalidated after dialogue and safety constraints are appended. The bundled workflow's machine-local Codex node stays removed.

Verification covers recommended-duration selection, catalog rendering, motion-strength graph injection, Codex prompt context, PromptRelay frame allocation, type checking, and a live generation on ComfyUI host 112.
