# LTX2.3 Multi-shot PromptRelay 720p Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the supplied LTX2.3 multi-shot PromptRelay workflow as a selectable, tested 720p ComfyUI video model without a runtime dependency on the host's Codex executable.

**Architecture:** Bundle a sanitized copy of the UI workflow and register a manual LTX2.3 profile. Extend profile-aware PromptRelay resolution to lock project-generated GLOBAL, LOCAL, and LENGTHS values directly on the relay node so graph pruning removes the internal Codex automation chain.

**Tech Stack:** TypeScript, Next.js, Vitest, ComfyUI UI-to-API workflow conversion, JSON capability catalog.

## Global Constraints

- Preserve the supplied model, LoRA, sampler, VAE, audio generation, and MP4 output chain.
- Fixed output capability is 720p at 25 FPS.
- The submitted API graph must not contain `RH_CODEX_NODE` or a machine-specific Codex path.
- Explicit `LENGTHS` controls relative segment timing; invalid values fall back safely to even allocation.
- Do not change the existing automatic workflow routing behavior.

---

### Task 1: Define the profile and product capability

**Files:**
- Modify: `src/lib/providers/comfyui/ltx23-workflow-profiles.ts`
- Modify: `standards/capabilities/image-video.catalog.json`
- Modify: `src/lib/api-config.ts`
- Modify: `src/app/api/user/models/route.ts`
- Test: `tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts`
- Test: `tests/integration/api/specific/user-models-comfyui-legacy-filter.test.ts`

**Interfaces:**
- Produces `COMFYUI_LTX23_WORKFLOW_KEYS.multiShotPromptRelayKj`.
- Produces a selectable profile with `promptPolicy: 'long_promptrelay'`, single-image slots, 25 FPS, and a 20-second maximum.

- [ ] Add failing assertions for the eighth profile and helper-model visibility.
- [ ] Run the two test files and confirm failures reference the missing profile/model.
- [ ] Add the profile, helper model entries, and fixed 720p capability entry.
- [ ] Re-run the two test files and confirm they pass.

### Task 2: Lock PromptRelay inputs and precise segment timing

**Files:**
- Modify: `src/lib/providers/comfyui/workflow-registry.ts`
- Test: `tests/unit/providers/comfyui-workflow-registry.test.ts`

**Interfaces:**
- Consumes the new workflow key.
- Produces a resolved `PromptRelayEncode` with direct `global_prompt`, `local_prompts`, and `segment_lengths` values.

- [ ] Add failing tests for exact LENGTHS, proportional normalization, invalid fallback, and absence of the Codex/regex chain.
- [ ] Run the registry test and confirm the expected failures.
- [ ] Add profile-aware direct prompt locking plus LENGTHS parsing and largest-remainder normalization.
- [ ] Re-run the registry test and confirm it passes.

### Task 3: Bundle and sanitize the workflow

**Files:**
- Create: `src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p.json`
- Test: `tests/unit/providers/comfyui-workflow-registry.test.ts`

**Interfaces:**
- Supplies one LoadImage input, node 618 frame control, node 605 PromptRelayEncode, node 619 aspect resize, and node 604 MP4 output.

- [ ] Copy the supplied UTF-8 workflow asset.
- [ ] Remove preview output metadata, stale embedded API prompt data, and the machine-specific Codex executable path.
- [ ] Resolve the workflow with a test prompt and assert image injection, 489-frame timing, 16:9/1280 resize controls, audio/video output, and no Codex node.
- [ ] Run the registry test and fix conversion or contract issues until green.

### Task 4: Verify the integration

**Files:**
- Verify all files changed by Tasks 1-3.

**Interfaces:**
- Produces a model visible in the selector and an executable ComfyUI API graph.

- [ ] Run targeted profile, registry, generator, and user-model tests.
- [ ] Run `npm.cmd run check:capability-catalog` and `npm.cmd run check:model-config-contract`.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run a resolved-workflow sanity check that reports dimensions, frame count, relay inputs, output node, and forbidden node count.
- [ ] Inspect `git diff --check` and the final scoped diff.
