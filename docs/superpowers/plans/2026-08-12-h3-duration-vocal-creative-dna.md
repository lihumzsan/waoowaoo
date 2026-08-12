# H3 Duration, Vocal Performance, and Creative DNA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend MiniMax H3 to verified 4–15 second generation, explicit vocal/lip-sync intent, and reusable video-direction mechanisms while preserving Provider prompt ownership.

**Architecture:** Keep duration limits in the capability catalog, H3 adapter, and profile math. Keep vocal intent as a project default plus per-video-item override, resolve it in the create-video Planner, and persist it as task/resource metadata separate from Provider `generationOptions`. Keep prompt behavior in the single `video-direction` Skill.

**Tech Stack:** TypeScript, Zod, Prisma/MySQL migrations, Vitest, Next.js/Temporal task contracts, Markdown Skill materialization.

## Global Constraints

- H3 legal integer duration is exactly 4–15 seconds; 4 seconds maps to 107 frames using the existing 24fps `17k+5` grid.
- `native_dialogue` is the backward-compatible default.
- Legal modes are exactly `native_dialogue`, `lip_sync_for_replacement`, `voiceover`, and `silent_no_lip`.
- `vocalPerformanceMode` is not a Provider generation option and must never be sent to ComfyUI.
- `silent_no_lip` cannot contain `<d>`, `</d>`, or `<cutoff>`; H3 still receives `generateAudio=true` because the current node requires it.
- Do not submit a real ComfyUI 4-second task; the user already verified it.
- Do not install the external T8 Skill repository or add unsupported H3 input modes.
- Keep `non_diegetic_music: N/A` and the independent BGM pipeline unchanged.

---

### Task 1: Define RED tests for duration, mode, and context

**Files:**
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`
- Create: `tests/contracts/vocal-performance-mode.contract.test.ts`
- Modify: `tests/contracts/project-production-prompt-profile-conformance.test.ts`

**Interfaces:**
- Consumes: existing H3 profile, capability catalog, project context resolver, and generation schemas.
- Produces: failing tests for the new public behavior.

- [ ] **Step 1: Add H3 duration boundary assertions**

Add assertions for `resolveH3DurationFrames(4) === 107`, rejection of 3 and 16, and the exact duration list `[4,5,6,7,8,9,10,11,12,13,14,15]`.

- [ ] **Step 2: Add vocal contract tests**

Define a minimal video item fixture. Assert all four values parse, unknown values fail, omitted item values remain parseable for old requests, and a resolved default is `native_dialogue`.

- [ ] **Step 3: Update the context fixture**

Assert schema version 7, `productionDefaults.video.vocalPerformanceMode`, H3 minimum duration 4, and default `native_dialogue`.

- [ ] **Step 4: Run RED**

```powershell
npm.cmd exec vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/contracts/vocal-performance-mode.contract.test.ts tests/contracts/project-production-prompt-profile-conformance.test.ts
```

Expected: failures caused by the missing feature, not test setup errors.

---

### Task 2: Implement shared mode contract and project default

**Files:**
- Modify: `src/lib/workspace-resource/generation-request.ts`
- Modify: `src/lib/config-service.ts`
- Modify: `src/lib/operations/domains/config/config-ops.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260812150000_add_video_vocal_performance_mode/migration.sql`
- Test: `tests/contracts/vocal-performance-mode.contract.test.ts`

**Interfaces:**
- Consumes: Task 1 RED tests.
- Produces: `VocalPerformanceMode`, `vocalPerformanceModeSchema`, validated project read/write, and migration-backed `native_dialogue` default.

- [ ] **Step 1: Add the forward migration**

```sql
ALTER TABLE `projects`
  ADD COLUMN `videoVocalPerformanceMode` VARCHAR(32) NOT NULL DEFAULT 'native_dialogue';
ALTER TABLE `workspace_resources`
  ADD COLUMN `vocalPerformanceMode` VARCHAR(32) NULL;
```

- [ ] **Step 2: Add the shared enum and item override**

Export the four-value tuple, type, and Zod schema. Add `vocalPerformanceMode: vocalPerformanceModeSchema.optional()` to video generation and failed-revision items. Keep batch output schema version 2 for compatibility.

- [ ] **Step 3: Add config read/write**

Extend `ProjectModelConfig` with `videoVocalPerformanceMode`. Read and validate the Prisma column in both deployment branches. Add `videoVocalPerformanceMode` to update input and `video_vocal_performance_mode` to the canonical tool command; allow all four values in local and cloud deployments.

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd exec vitest run tests/contracts/vocal-performance-mode.contract.test.ts
```

---

### Task 3: Project context and H3 4–15-second support

**Files:**
- Modify: `src/lib/project-production-context.ts`
- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `src/lib/ai-providers/comfyui/profiles.ts`
- Modify: `tests/contracts/project-production-prompt-profile-conformance.test.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`

**Interfaces:**
- Consumes: Task 2 shared mode/config types.
- Produces: schema-version-7 context, project default projection, H3 duration floor 4, and 107-frame conversion.

- [ ] **Step 1: Project the default**

Add `productionDefaults.video.vocalPerformanceMode` from config, change context schema version from 6 to 7, and include it in the existing context hash.

- [ ] **Step 2: Change H3 duration declarations**

Set catalog options to 4–15, adapter validator to `{ min: 4, max: 15 }`, and `H3_DURATION_MIN_SECONDS` to 4. Do not modify workflow JSON or the existing frame-grid formula.

- [ ] **Step 3: Verify**

```powershell
npm.cmd exec vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/contracts/project-production-prompt-profile-conformance.test.ts
```

---

### Task 4: Freeze resolved mode without Provider leakage

**Files:**
- Modify: `src/lib/workspace-resource/generation-contract.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/workspace-resource/persistence.ts`
- Modify: `src/lib/workspace-resource/contracts.ts`
- Modify: `src/lib/workspace-resource/view-service.ts`
- Modify: `src/lib/task/execution/handlers/workspace-resource-video.ts`
- Create: `tests/contracts/vocal-performance-generation.contract.test.ts`

**Interfaces:**
- Consumes: Task 2 mode type and Task 3 project default.
- Produces: task payload field, stable fingerprint, retry preservation, Resource provenance, and silent-mode guard.

- [ ] **Step 1: Write contract tests first**

Assert video task payloads accept a mode, image/audio payloads reject it, unknown values fail, and Provider `generationOptions` do not require or contain the mode.

- [ ] **Step 2: Extend task contracts**

Add `vocalPerformanceMode` to the task payload with a refinement requiring it for video and forbidding it for non-video. Preserve it through normal and retry parser projections.

- [ ] **Step 3: Resolve and freeze**

In `buildPlannedItem`, compute `item.vocalPerformanceMode ?? config.videoVocalPerformanceMode` for video items. Include the resolved value in `generationInputFingerprint`, task payload, and Resource persistence inputs; never add it to `compiled.generationOptions`.

- [ ] **Step 4: Preserve retries**

`revise_failed` uses its explicit replacement override or the original frozen mode. `rerun_failed` reuses the frozen task payload value and never rereads a changed project default.

- [ ] **Step 5: Add the silent guard**

Before task side effects, reject resolved `silent_no_lip` prompts containing `<d>`, `</d>`, or `<cutoff>`. Do not validate arbitrary English wording.

- [ ] **Step 6: Verify**

```powershell
npm.cmd exec vitest run tests/contracts/vocal-performance-generation.contract.test.ts
npm.cmd run typecheck
```

---

### Task 5: Update the single video-direction Skill

**Files:**
- Modify: `src/lib/creative-skills/skills/video-direction/SKILL.md`
- Modify: `src/lib/creative-skills/registry.ts`
- Modify or create: focused runtime Skill materialization test

**Interfaces:**
- Consumes: project default, item contract, H3 profile, and freeze semantics from Tasks 2–4.
- Produces: explicit mode per emitted video item and compact Creative DNA mechanisms in the automatically materialized Skill.

- [ ] **Step 1: Record baseline pressure scenarios**

Run the current Skill on: 4-second dialogue with a second shot; silent mode with source dialogue; replacement lip-sync without transcript; voiceover over visible characters; floating subject; reaction without visible cause; and an external-case copy request. Record violations before editing.

- [ ] **Step 2: Add four-mode recipe rules**

Require each new item to emit `vocalPerformanceMode`. Define exact `<d>` behavior for `native_dialogue`, transcript requirements for `lip_sync_for_replacement`, closed lips for `voiceover`, and no `<d>`/`<cutoff>` plus `N/A` sound fields for `silent_no_lip`.

- [ ] **Step 3: Add reusable mechanisms**

Add concise conditional recipes for feasibility gates, spatial continuity proof, causal proof, 2–3 stable identity anchors, one primary camera behavior, repair recipes, and anti-copy constraints. Do not add unsupported model syntax or parallel outputs.

- [ ] **Step 4: Bump the Skill registry version**

Increment `video-direction` from `4.2.1` to `4.3.0`.

- [ ] **Step 5: Verify materialization and scenarios**

Materialize the runtime Skill, confirm it includes the output contract and new rules, then rerun the same scenarios and manually score behavior. Do not treat source-string presence as the behavior oracle.

---

### Task 6: Full affected verification and implementation commit

**Files:**
- Modify: only files from Tasks 1–5
- Test: focused contracts, named workspace-resource suites, Prisma generation/check, and typecheck

**Interfaces:**
- Consumes: all completed tasks.
- Produces: reviewed implementation commit; no push or merge.

- [ ] **Step 1: Generate Prisma client and validate migration shape**

Run the repository’s documented Prisma generation/check command. Do not apply the migration to production or submit a real H3 job.

- [ ] **Step 2: Run focused verification**

```powershell
npm.cmd exec vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/contracts/project-production-prompt-profile-conformance.test.ts tests/contracts/vocal-performance-mode.contract.test.ts tests/contracts/vocal-performance-generation.contract.test.ts
npm.cmd run typecheck
```

- [ ] **Step 3: Run broader affected suites**

Use package scripts for workspace-resource generation and video-merge contracts/integration. Report unrelated baseline failures separately.

- [ ] **Step 4: Inspect boundaries**

Confirm the mode is absent from Provider `generationOptions`, H3 workflow JSON is unchanged, no external Skill files were copied, and `non_diegetic_music: N/A` remains fixed.

- [ ] **Step 5: Commit**

```powershell
git add prisma src tests
git commit -m "feat: add H3 vocal performance controls"
```

Do not push or merge until requested.
