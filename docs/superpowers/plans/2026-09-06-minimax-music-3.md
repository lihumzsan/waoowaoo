# MiniMax Music 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register MiniMax Music 3 as the default local ComfyUI music model with explicit vocal lyrics, one profile-driven execution path, and two real runs against the current H3 ComfyUI instance.

**Architecture:** Keep `create_audio`, the WorkspaceResource audio Task handler, provider invocation fence, terminal service, and Resource materializer unchanged as the sole business path. Replace ACE-only ComfyUI music dispatch with an exhaustive music profile registry that owns identity, capabilities, runtime target, graph construction, option validation, and canonical output node, while a shared runtime owns submit/poll/cancel/download.

**Tech Stack:** TypeScript, Zod, Next.js server modules, Temporal Task execution, ComfyUI HTTP job API, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-minimax-music-3-design.md`

## Global Constraints

- Use only the existing local `comfyui` Provider and current H3 ComfyUI runtime.
- Keep `create_audio` as the only public execution entry.
- Keep Task Terminal Service and WorkspaceResource materializer as the only terminal writers.
- No Provider fallback, prompt parsing, database migration, new route, new queue, or new state machine.
- Do not modify `C:/workspace/image/MiniMax+Music音乐生成.json`.
- Do not add tests that mirror source structure; tests must use the user-verified workflow, cross-field product contract, live Provider protocol, or production registry as their oracle.

---

### Task 1: Freeze explicit vocal lyrics in the canonical audio contract

**Files:**
- Modify: `src/lib/workspace-resource/generation-request.ts`
- Modify: `src/lib/workspace-resource/audio-execution-contract.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/ai-exec/engine.ts`
- Modify: `src/lib/ai-providers/runtime-types.ts`
- Test: `tests/contracts/workspace-resource-audio-execution-contract.test.ts`

**Interfaces:**
- Consumes: prompt music items with `vocalMode`.
- Produces: `lyrics?: string` in prompt music items, normalized generation options, frozen Task payload, retry source, and `AiMusicExecutionOptions`.

- [ ] **Step 1: Write failing contract tests**

Add literal cases that prove `vocal` requires non-empty lyrics, `instrumental` rejects caller lyrics, and `freezeAudioExecution` preserves the exact lyrics string in `generationOptions`.

```ts
expect(promptMusicGenerationItemSchema.safeParse({ ...base, vocalMode: 'vocal' }).success).toBe(false)
expect(promptMusicGenerationItemSchema.parse({ ...base, vocalMode: 'vocal', lyrics }).lyrics).toBe(lyrics)
expect(promptMusicGenerationItemSchema.safeParse({ ...base, vocalMode: 'instrumental', lyrics }).success).toBe(false)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/contracts/workspace-resource-audio-execution-contract.test.ts`

Expected: FAIL because `lyrics` is not accepted or frozen.

- [ ] **Step 3: Implement the strict shared contract**

Add `lyrics` to the prompt music item and options types. Use a shared non-whitespace schema and cross-field validation:

```ts
if (item.vocalMode === 'vocal' && !item.lyrics) {
  context.addIssue({ code: 'custom', path: ['lyrics'], message: 'lyrics are required for vocal music.' })
}
if (item.vocalMode === 'instrumental' && item.lyrics !== undefined) {
  context.addIssue({ code: 'custom', path: ['lyrics'], message: 'lyrics are forbidden for instrumental music.' })
}
```

Pass `item.lyrics` into requested scalar options so `preflight.options`, Task payload, retry parsing, request hashing, and provider execution all consume the same frozen string.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/contracts/workspace-resource-audio-execution-contract.test.ts`

Expected: PASS with no skipped tests.

### Task 2: Create the exhaustive ComfyUI music profile registry

**Files:**
- Create: `src/lib/ai-providers/comfyui/music-profiles.ts`
- Create: `src/lib/ai-providers/comfyui/music-runtime.ts`
- Create: `src/lib/ai-providers/comfyui/workflows/minimax-music-3.json`
- Delete: `src/lib/ai-providers/comfyui/ace-step.ts`
- Modify: `src/lib/ai-providers/comfyui/profile-requirements.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `src/lib/ai-providers/comfyui/async-task.ts`
- Test: `tests/contracts/comfyui-ace-step-music.contract.test.ts`
- Test: `tests/contracts/comfyui-runtime-target-conformance.test.ts`
- Test: `tests/unit/ai-providers/comfyui/profile-requirements.test.ts`

**Interfaces:**
- Produces: `COMFYUI_MUSIC_PROFILES`, `describeComfyUiMusic`, `executeComfyUiMusicGeneration`, `pollComfyUiMusic`, and `cancelComfyUiMusic`.
- Invariant: every music profile has output node `107`, a unique model key, one runtime target, one option schema, and one graph builder.

- [ ] **Step 1: Write failing profile and conformance tests**

Use the attached working workflow as the independent wire oracle. Assert that the wished-for MiniMax builder maps exact Caption, Lyrics, duration and seed values to the encoder/sampler and returns a Graph whose output node `107` is MP3 `SaveAudioAdvanced`. Refactor runtime-target conformance to enumerate `COMFYUI_MUSIC_PROFILES` instead of maintaining a handwritten model list.

```ts
const graph = buildMiniMaxMusic3PromptGraph({
  prompt: 'Global Metadata: restrained cinematic ambient.',
  lyrics: '[Verse]\nA quiet line',
  durationSeconds: 60,
  seed: 4242,
})
expect(graph['42']?.inputs).toMatchObject({ caption: expect.any(String), lyrics: expect.any(String), max_duration: 60, seed: 4242 })
expect(graph['47']?.inputs.seed).toBe(4242)
expect(graph['107']?.inputs).toMatchObject({ format: 'mp3', 'format.quality': 'V0' })
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/contracts/comfyui-ace-step-music.contract.test.ts tests/contracts/comfyui-runtime-target-conformance.test.ts tests/unit/ai-providers/comfyui/profile-requirements.test.ts`

Expected: FAIL because the registry, MiniMax profile and DualCLIP requirement mapping do not exist.

- [ ] **Step 3: Build the production API Graph**

Create a nine-node immutable API Graph using node ids `41`, `42`, `43`, `44`, `45`, `46`, `47`, `48`, and `107`. Link the encoder seconds output to the latent node, use the normal VAE decode branch selected by the verified UI workflow, and connect node `107` to decoded audio.

- [ ] **Step 4: Implement the profile registry and shared runtime**

Move ACE graph construction into `music-profiles.ts`, add MiniMax, and expose a resolver that requires exact `provider/modelId/modelKey`. Derive describe and execute from the resolved profile. Extend profile requirements with `DualCLIPLoader.clip_name1/clip_name2`.

The shared runtime must:

```ts
const profile = resolveComfyUiMusicProfile(input.selection)
const target = resolveComfyUiRuntimeTarget(profile.runtimeTargetId)
const graph = profile.buildGraph({ prompt, lyrics, durationSeconds, seed })
await preflightMusicProfile(target.baseUrl, profile, graph)
return await submitComfyUiMusicPrompt({ target, profile, graph, promptId })
```

Poll and cancel must accept any registered runtime target and read only canonical output node `107`; they must not branch on a model name.

- [ ] **Step 5: Replace old entry points**

Point `comfyuiAdapter.music` and the async provider registration at the shared registry/runtime and remove `ace-step.ts`. Update imports; do not leave a forwarding re-export.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the same focused Vitest command from Step 2.

Expected: PASS.

### Task 3: Derive catalog, runtime target and defaults from the profile registry

**Files:**
- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/platform-runtime/presets.ts`
- Modify: `src/lib/ai-registry/platform-models.ts`
- Modify: `.env.example`
- Test: `tests/contracts/comfyui-runtime-target-conformance.test.ts`
- Test: `tests/contracts/provider-api-config-conformance.test.ts`

**Interfaces:**
- Consumes: `COMFYUI_MUSIC_PROFILES`.
- Produces: capability catalog, API config models, platform presets, model-to-target map, and platform default `comfyui::minimax-music-3`.

- [ ] **Step 1: Extend the failing conformance expectations**

Require production registry enumeration to prove each music profile appears exactly once in capability catalog, API config catalog, platform presets and runtime mapping. Assert MiniMax capability behavior, not a hand-maintained full model list:

```ts
expect(minimax.capabilities.music).toMatchObject({
  generationModes: ['prompt'],
  durationSecondsRange: { min: 1, max: 360 },
  vocalModeOptions: ['instrumental', 'vocal'],
  outputFormatOptions: ['mp3'],
})
```

- [ ] **Step 2: Run conformance tests and verify RED**

Run: `npx vitest run tests/contracts/comfyui-runtime-target-conformance.test.ts tests/contracts/provider-api-config-conformance.test.ts`

Expected: FAIL because catalog/default derivation is incomplete.

- [ ] **Step 3: Derive catalogs and switch the platform default**

Build the music portions of exported catalogs from the registry. Map MiniMax to `h3-dual-stage-2mp`. Export per-model defaults and apply them in platform runtime presets. Change the example platform default comment to `comfyui::minimax-music-3`.

- [ ] **Step 4: Run conformance tests and verify GREEN**

Run the same command from Step 2.

Expected: PASS.

### Task 4: Align the single creative writer with prompt and composition modes

**Files:**
- Modify: `src/lib/creative-skills/skills/music-direction/SKILL.md`
- Modify: `src/lib/creative-skills/runtime-skills.ts`

**Interfaces:**
- Consumes: injected `productionCapabilities.music.generationMode`, duration range and vocalModeOptions plus the runtime-injected strict output schema.
- Produces: one valid `audio_generation_batch` for either prompt music or composition-plan music.

- [ ] **Step 1: Rewrite the professional instructions without a model-name branch**

Document two exhaustive modes. Prompt mode writes final Caption directly into `prompt`; vocal output includes section-tagged `lyrics`; instrumental output omits lyrics. Composition mode retains its existing plan rules. Replace the invalid `no_music` decision with `no_audio`.

- [ ] **Step 2: Self-review the Skill against the generated machine schema**

Confirm prose does not duplicate a JSON template, does not mention MiniMax/ACE as routing logic, does not ask a service to rewrite prompt content, and uses only fields present in `audioGenerationBatchOutputSchema`.

- [ ] **Step 3: Run creative/output conformance**

Run: `npx vitest run tests/contracts/creative-output-registry-conformance.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts`

Expected: PASS.

### Task 5: Run static and retained-suite verification

**Files:**
- No production changes unless a valid failure exposes a defect in this feature.

- [ ] **Step 1: Run focused static checks**

Run:

```powershell
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.runtime-scripts.json
npm run check:capability-catalog
npm run check:model-config-contract
```

Expected: all exit 0.

- [ ] **Step 2: Run retained logic and conformance suites**

Run:

```powershell
npm run test:logic
npm run test:conformance
```

Expected: all files execute, zero failures and zero skipped tests.

- [ ] **Step 3: Run applicable Provider critical suite**

Run: `npm run test:critical:provider`

Expected: exit 0, or report a missing real dependency as an explicit unverified boundary without replacing it with mocks.

### Task 6: Validate twice against the current H3 ComfyUI

**Files:**
- Create temporarily, then delete: ignored smoke runner outside tracked deliverables.

**Interfaces:**
- Consumes: `COMFYUI_H3_DUAL_STAGE_BASE_URL` from the existing local `.env` and public `generateMusic` engine entry.
- Produces: no repository artifact; emits prompt id, external target, byte length, MIME type and measured duration for each run.

- [ ] **Step 1: Confirm live runtime contract**

Read `/object_info` for every class in the selected MiniMax profile and assert the three exact model files are available.

- [ ] **Step 2: Execute real instrumental run**

Call `generateMusic` with model key `comfyui::minimax-music-3`, a final caption, `vocalMode=instrumental`, `durationSeconds=10`, and `outputFormat=mp3`. Decode the returned audio data, probe it with ffprobe, and remove the temporary file.

- [ ] **Step 3: Execute real vocal run**

Call the same public engine entry with a different caption, `vocalMode=vocal`, explicit `[Verse]`/`[Chorus]` lyrics, `durationSeconds=10`, and MP3. Probe and clean up as above.

- [ ] **Step 4: Verify both independent job identities completed**

Require two distinct prompt ids/external ids and two non-empty playable MP3 results. Any Provider failure must be fixed through the profile/contract and rerun; no fallback model is permitted.

### Task 7: Review-fix loops and final verification

**Files:**
- Modify only files implicated by valid review findings.

- [ ] **Step 1: Commit the implementation checkpoint**

```powershell
git add docs src tests .env.example
git commit -m "feat(audio): integrate MiniMax Music 3"
```

- [ ] **Step 2: Dispatch independent full code review**

Review the complete base-to-head diff against this plan, AGENTS.md, provider-gateway, audio-production, workspace-resource, async-task-lifecycle and test-governance. Fix every Critical and Important finding using TDD where behavior changes.

- [ ] **Step 3: Re-run full review after fixes**

Commit fixes, then dispatch a fresh full review of the entire base-to-new-head range. Repeat fix and review until the reviewer reports no Critical or Important findings and no unresolved architecture conflict.

- [ ] **Step 4: Run fresh final verification**

Re-run Task 5 commands and both Task 6 real ComfyUI generations after the last code change. Record the existing baseline `check:local-provider-boundary` failure separately if it remains unchanged.

- [ ] **Step 5: Audit completion requirements**

Confirm: one execution entry, one Task/Resource terminal writer, no fallback, no ACE-only poll branch, no UI workflow helpers in production Graph, exact MiniMax model provenance, two real H3 ComfyUI runs, clean Git status, and no unresolved Critical/Important review findings.
