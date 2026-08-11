# H3 Capability Defaults and Actionable Preflight Errors

## Goal

Allow the existing local MiniMax H3 single-frame and first/last-frame workflows to pass the shared media preflight without requiring a manually stored capability-default record. Preserve the exact workflow choice derived from explicit frame roles.

## Confirmed Root Cause

The self-hosted user-key project selects `comfyui::minimax-h3-fast`, but its stored `capabilityDefaults` is empty. The shared capability resolver requires every declared H3 option and therefore fails first on `resolution`, then on `generateAudio`. The existing platform runtime preset already declares the intended H3 defaults as `resolution=720p` and `generateAudio=true`, but `getProjectModelConfig` only exposes those defaults in platform-key deployments.

`maxReferenceFiles=0` is not the cause. That limit applies only to generic reference mode. Explicit `first_frame` and `last_frame` inputs are validated separately and already route to the two supplied H3 workflows.

## Design

### Default ownership

`getPlatformCapabilityDefaults()` remains the sole source of built-in runtime defaults. In self-hosted user-key configuration reads, merge its per-model defaults underneath persisted user defaults:

1. built-in runtime defaults;
2. persisted user capability defaults;
3. persisted project capability overrides, applied by the existing capability resolver.

The merge is nested by exact model key so a user can override `resolution` without deleting the required built-in `generateAudio=true` value. Irrelevant built-in model entries are harmless because capability resolution reads only the selected exact model key.

Apply the same default merge to project-scoped and user-scoped model configuration so both consumers use one rule.

### Workflow routing

Do not modify the ComfyUI graphs or routing:

- one explicit `first_frame` produces `imageUrl` only and selects `h3-fast-first-frame`;
- explicit `first_frame + last_frame` also produces `lastFrameImageUrl` and selects `h3-fast-first-last-frame`;
- generic reference media remains unsupported by H3.

### Error surface

When capability resolution still fails with a stable `CAPABILITY_*` error, return a dedicated invalid-parameter surface that preserves the original reason. Do not collapse it into the generic `MEDIA_GENERATION_PREFLIGHT_FAILED` message. Other unknown errors keep the existing generic wrapper.

## Non-goals

- No change to the two supplied workflow graphs, profile selection, ComfyUI model files, or node preflight.
- No database migration or silent write-back of defaults.
- No use of legacy `Project.videoResolution` as a second capability source.
- No change to generic reference-media limits.
- No Cloud behavior change.

## Verification

- A self-hosted user-key project with H3 selected and empty stored capability defaults resolves `normal` and `firstlastframe` requests with `720p` and `generateAudio=true`.
- A stored resolution override wins while `generateAudio=true` remains present.
- Explicit single-frame and first/last-frame roles still select the two existing H3 profiles.
- A remaining capability failure exposes its stable reason instead of the generic preflight code.
- Existing H3 submission, capability, WorkspaceResource, typecheck, and targeted lint checks remain green.
