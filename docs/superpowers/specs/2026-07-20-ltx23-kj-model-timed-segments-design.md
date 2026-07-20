# LTX2.3 KJ Model-Timed Segments Design

The KJ PromptRelay card keeps the storyboard panel's own recommended duration. For the supplied test project, shot 5 is therefore 9 seconds; switching from Bernini to KJ must retain 9 as the selected recommended value.

KJ prompt enhancement always uses `codex::gpt-5.5`. The Codex provider already runs text completions with `model_reasoning_effort="xhigh"` and `service_tier="fast"`, so this gives the requested highest-reasoning, fastest service configuration without changing other project AI tasks.

GPT-5.5 owns the temporal analysis. For a 9-second, 25 FPS request it receives the total duration and 225-frame budget, analyzes the concrete action beats, writes exactly three numbered LOCAL descriptions, and returns a `segment_frames` array with three positive integer frame counts. The counts must total 225 and must not all be equal. Longer KJ durations retain the existing 4/5 LOCAL count policy.

The application validates the model output before use, appends a canonical `LENGTHS:` line, and lets the locked PromptRelay adapter write those unequal values into `segment_lengths` (and `timeline_data` only for workflow variants that expose that input). Invalid counts, totals, equal allocation, reserved markers, or relay separators are rejected. The fallback remains structurally safe and uses a deterministic non-equal allocation because content-aware timing is unavailable when GPT-5.5 fails.

Verification covers the shot-5 9-second selection, forced GPT-5.5 model key, non-equal model-selected frames, malformed timing rejection, graph injection, type checking, and one live 9-second generation on host 112.
