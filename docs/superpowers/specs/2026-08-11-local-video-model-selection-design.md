# Local Video Model Selection and Project Write Validation

## Goal

Make the self-hosted project video-model configuration accept only runtime-selectable local ComfyUI video models through one authoritative policy. The current selectable model is `comfyui::minimax-h3-fast`. Tool, API, and MCP callers must receive the same decision before `Project.videoModel` is persisted.

## Current Facts

- `update_project_config` exposes Tool, API, and MCP channels.
- The Tool canonicalizer validates a requested video model through `resolveModelSelection`, while the canonical API/MCP input can reach the transaction writer with only syntactic `provider::modelId` validation.
- `list_user_models` hides custom-provider models whose provider has no stored API key.
- The runtime resolver can still accept those stored custom models and fail later when provider credentials are loaded.
- Built-in ComfyUI models do not require a user API key. Their connection is resolved from the local ComfyUI configuration.
- The active deployment is self-hosted. Cloud behavior is outside this change.

## Scope

### In scope

- Define one reusable policy for selectable self-hosted local video models.
- Source that policy from the production platform-model catalog, limited to video models owned by the built-in ComfyUI provider.
- Use the policy when listing selectable video models.
- Use the same policy in the authoritative `update_project_config` transaction path before persisting a non-null `videoModel`.
- Preserve `null` as the explicit command for clearing the project video-model override through canonical API/MCP inputs.
- Preserve the existing Agent command shape for selecting a video model or video ratio.
- Return a stable invalid-parameter error when a requested video model is malformed, has the wrong modality, is not registered as a local ComfyUI video model, or is otherwise unavailable.

### Out of scope

- Adding, configuring, or validating API-key-backed custom video providers.
- Removing custom-provider support for image, LLM, music, or other runtime paths.
- Adding new video models or workflows beyond the already registered H3 integration.
- Changing Cloud deployment capabilities or command publication.
- Changing project video ratios, capability overrides, generation duration, ComfyUI workflow execution, or provider credentials.

## Authoritative Policy

The selectable local-video-model set is derived from the production platform-model catalog:

1. The model type must be `video`.
2. The provider family must be the built-in `comfyui` provider.
3. The exact canonical identity must be `provider::modelId` from the catalog.
4. A stored custom model declaration cannot add itself to this set.
5. A user API key is neither required nor consulted for this set.

H3 is not special-cased in the validator. It is accepted because `comfyui::minimax-h3-fast` is registered in the production ComfyUI video catalog. A future built-in local ComfyUI video model becomes selectable by joining the same catalog and satisfying the same registry contracts.

## Data Flow

### Listing

`list_user_models` continues to build all modality groups, but its `video` group uses the authoritative local-video-model set. Custom-provider video declarations do not enter that group. Other modality groups retain their current credential-aware behavior.

### Writing

All `update_project_config` channels converge on `executeInTransaction`. Before constructing the project update:

- absent `videoModel` means no change;
- `null` means clear the project override;
- a string is normalized and resolved against the authoritative local-video-model set;
- every other value or unresolved identity fails before the project write.

The Tool canonicalizer only maps the Agent command into canonical operation input. It does not own the final business decision. This leaves one authoritative validation point for Tool, API, and MCP.

## Failure Behavior

Rejected video-model values use the existing project-config invalid-parameter surface with:

- error code: `PROJECT_VIDEO_MODEL_NOT_AVAILABLE`;
- field: `videoModel`.

The rejection happens before persistence. The existing project configuration remains unchanged.

## Cloud Boundary

This change does not alter Cloud behavior. Existing Cloud field restrictions remain in force. The known mismatch between Cloud command publication and execution is recorded as an unaddressed repository concern, not treated as part of the local H3 delivery.

## Verification

Verification must use independent production-contract evidence rather than source-string or mock-call assertions:

- Registry/conformance evidence that the production local-video set contains H3 and excludes non-video or custom-provider identities.
- Operation execution evidence that Tool and canonical API inputs converge on the same validation outcome before persistence.
- A real transaction/database oracle, when available in the existing test infrastructure, proving rejected values do not change `Project.videoModel` and H3 does.
- Focused typecheck/lint for the touched modules.
- Existing H3 provider and configuration conformance checks remain green.

## Acceptance Criteria

- `comfyui::minimax-h3-fast` is listed and can be persisted as the project video model without a user API key.
- A custom-provider video model is not listed as selectable for project video configuration, even if present in stored custom-model JSON.
- A wrong-modality model and an unknown model are rejected identically through Tool, API, and MCP canonical inputs.
- Rejected values are not persisted.
- Other modality lists and resolution behavior are unchanged.
- No Cloud feature expansion or H3 literal-only branch is introduced.
