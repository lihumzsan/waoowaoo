# MiniMax H3 Dual-Stage 2MP Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current MiniMax H3 first-frame/first-last-frame implementation with one reference-image, dual-model, dual-RTX-VSR ComfyUI workflow that produces fixed 2MP video on the isolated `127.0.0.1:8188` runtime.

**Architecture:** Keep one Wao video Task, one provider submission fence, one ComfyUI prompt id, and one final MP4. A typed ComfyUI runtime-target registry binds H3 to `h3-dual-stage-2mp`, while four-part external ids preserve that target through submit, poll, cancel, and download. The main Wao Agent remains the only Prompt writer; a canonical API graph performs first-stage H3 generation, 1MP RTX VSR, second-stage low-denoise redraw, 2MP RTX VSR, and final native-audio muxing in one provider job.

**Tech Stack:** TypeScript, Vitest, ComfyUI `/prompt` and `/api/jobs`, canonical API workflow JSON, Next.js/Temporal Task execution, Codex App Server creative Skill, local MinIO, NVIDIA RTX VSR, ffprobe.

## Global Constraints

- At execution start, use `superpowers:using-git-worktrees`; do not implement in the current main worktree.
- Before editing the Wao creative Skill in Task 2, invoke `superpowers:writing-skills` and follow its baseline/pressure-test workflow.
- Use `superpowers:test-driven-development` for every production behavior change and `verify-after-code-change` after each code-level task.
- Before any completion claim, use `superpowers:verification-before-completion`; before integration, use `superpowers:requesting-code-review` and `superpowers:finishing-a-development-branch`.
- Preserve unrelated dirty files, especially the pre-existing untracked `.superpowers/` directory.
- Do not delete database rows, media objects, ComfyUI outputs, or historical Task records. Old H3 identities may become unreadable, but no cleanup is required.
- Do not add a compatibility parser, alias, fallback, second workflow route, second Prompt writer, second Wao Task, or second provider submission.
- H3 must resolve only `COMFYUI_H3_DUAL_STAGE_BASE_URL=http://127.0.0.1:8188`; it must never fall back to `COMFYUI_BASE_URL`.
- Music, sound, TTS, and voice continue to use the `shared` target backed by `COMFYUI_BASE_URL`.
- H3 accepts exactly one `reference_image`, integer duration 4–15, and one of `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `9:21`.
- Quality is fixed: 1MP first/second-stage working size, 10-step Euler first stage, 3-step `res_multistep` second stage with `denoise=0.2`, and 2MP final `nvidia_rtx_vsr` output.
- Preserve first-stage native dialogue, ambience, action sounds, and non-verbal voice; forbid non-diegetic background music.
- Keep both `easy clearCacheAll` nodes and the exact first-stage-audio-to-final-mux connection.
- Reuse the shared 512MB `MAX_VIDEO_BYTES` boundary; do not retain the old private 100MB H3 limit or introduce an unbounded download.
- User-visible names and fixed-quality explanations must be Chinese-readable/i18n-safe; do not hard-code UI-only Chinese in production logic.
- No browser/Chrome control is authorized for this task. Use source, local APIs, Task state, ComfyUI history, and generated media inspection.
- The approved design is `docs/superpowers/specs/2026-08-16-minimax-h3-dual-stage-2mp-replacement-design.md`; stop and re-review if implementation requires a second writer or state machine.

---

## File Structure

### New focused files

- `src/lib/ai-providers/comfyui/external-id.ts`: pure four-part ComfyUI external-id formatter/parser.
- `src/lib/video-generation/h3-reference-prompt.ts`: the single deterministic parser/validator for `minimax_h3_reference_v2` Prompt structure.
- `src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json`: canonical `/prompt` graph; no UI-canvas metadata or Codex node.
- `tests/unit/ai-providers/comfyui/external-id.test.ts`: protocol oracle for target-aware external ids.
- `tests/contracts/comfyui-runtime-target-conformance.test.ts`: production ComfyUI model-to-target exhaustiveness oracle.
- `tests/unit/video-generation/h3-reference-prompt.test.ts`: six-section Prompt oracle.

### Existing files with clear ownership

- `src/lib/ai-providers/comfyui/config.ts`: typed runtime-target registry and URL parsing.
- `src/lib/ai-providers/comfyui/async-task.ts`: modality dispatch using parsed target identity.
- `src/lib/ai-providers/comfyui/profiles.ts`: H3 graph metadata, immutable graph cloning, dimensions, frames, and dynamic node injection.
- `src/lib/ai-providers/comfyui/h3.ts`: H3-specific preflight, submission disposition, poll/cancel, and exact output extraction.
- `src/lib/ai-providers/comfyui/adapter.ts`: canonical H3 option schema.
- `src/lib/ai-providers/comfyui/models.ts`: model identity, runtime-target declaration, defaults, capability, and display name.
- `src/lib/ai-providers/comfyui/transport.ts`: reusable exact-node video-output reader and bounded output download.
- `src/lib/ai-providers/comfyui/ace-step.ts`, `moss.ts`, `tts.ts`: shared-target external ids and target-aware poll/cancel.
- `src/lib/ai-registry/types.ts`: exhaustive Prompt profile value.
- `src/lib/ai-exec/media-preflight.ts` and `src/lib/user-api/runtime-config.ts`: selected-model-aware runtime configuration preflight.
- `src/lib/operations/domains/workspace-resource/generation-ops.ts`: capability-driven H3 Prompt validation before Task creation.
- `src/lib/creative-skills/skills/video-direction/SKILL.md` and `src/lib/creative-skills/registry.ts`: new reference-video Prompt dialect and Skill version.
- `.env.example`, `tests/setup/env.ts`: isolated H3 URL and new default model identity.

### Legacy files deleted at hard cutover

- `src/lib/ai-providers/comfyui/workflows/h3-fast-first-frame.json`
- `src/lib/ai-providers/comfyui/workflows/h3-fast-first-last-frame.json`

---

### Task 0: Create the isolated implementation workspace and re-audit ownership

**Files:**
- Read: `AGENTS.md`
- Read: `docs/architecture/modules/provider-gateway.md`
- Read: approved design and this plan
- Modify: none

**Interfaces:**
- Produces: an isolated `codex/` worktree, a recorded base SHA, and confirmation that no new conflicting H3 work landed after the design commit.
- Every later task runs in this worktree and uses the same base SHA for final diff review.

- [ ] **Step 1: Invoke the required worktree Skill and inspect Git state**

Use `superpowers:using-git-worktrees`. Before creating the worktree, run `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, and `git log -5 --oneline`. Preserve `.superpowers/` and any unrelated dirty state in the original checkout.

- [ ] **Step 2: Re-run history and architecture routing checks**

Run:

```powershell
git log --follow -5 -- src/lib/ai-providers/comfyui/h3.ts
git log --follow -5 -- src/lib/ai-providers/comfyui/profiles.ts
git log --follow -5 -- src/lib/ai-providers/comfyui/models.ts
git log -5 -- src/lib/ai-providers/comfyui/async-task.ts src/lib/ai-providers/comfyui/config.ts
npm.cmd run architecture:impact -- src/lib/ai-providers/comfyui src/lib/ai-registry/types.ts src/lib/operations/domains/workspace-resource/generation-ops.ts
```

Read every module contract reported by the impact command. Confirm the approved design already covers Prompt, runtime target, external-id lifecycle, failure/retry, output, deletion, and writer-count changes. If a new commit introduced a second H3 path or changed provider lifecycle ownership, stop and revise the design before editing.

- [ ] **Step 3: Record the implementation base**

In the isolated worktree record:

```powershell
$h3ImplementationBase = git rev-parse HEAD
```

Keep this value in the execution notes and use it for `git diff --check "$h3ImplementationBase..HEAD"` in Task 6. Do not write a tracked governance scratch file.

---

### Task 1: Make ComfyUI runtime identity durable and isolated

**Files:**
- Create: `src/lib/ai-providers/comfyui/external-id.ts`
- Create: `tests/unit/ai-providers/comfyui/external-id.test.ts`
- Create: `tests/contracts/comfyui-runtime-target-conformance.test.ts`
- Modify: `src/lib/ai-providers/comfyui/config.ts`
- Modify: `src/lib/ai-providers/comfyui/async-task.ts`
- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/ai-providers/comfyui/h3.ts`
- Modify: `src/lib/ai-providers/comfyui/ace-step.ts`
- Modify: `src/lib/ai-providers/comfyui/moss.ts`
- Modify: `src/lib/ai-providers/comfyui/tts.ts`
- Modify: `src/lib/ai-providers/index.ts`
- Modify: `src/lib/ai-providers/async-task-types.ts`
- Modify: `src/lib/ai-exec/media-preflight.ts`
- Modify: `src/lib/user-api/runtime-config.ts`
- Modify: `.env.example`
- Modify locally but never stage: `.env`
- Modify: `tests/unit/ai-providers/comfyui/config.test.ts`
- Modify: `tests/unit/ai-providers/comfyui-async-task.test.ts`
- Modify: applicable ComfyUI music/sound/TTS contract fixtures that assert external ids

**Interfaces:**
- Produces: `COMFYUI_RUNTIME_TARGET_IDS`, `ComfyUiRuntimeTargetId`, `resolveComfyUiRuntimeTarget(targetId, environment)`, `formatComfyUiExternalId(input)`, and `parseComfyUiExternalId(externalId)`.
- Produces: `resolveComfyUiRuntimeTargetIdForModelKey(modelKey)` in the ComfyUI model registry; every registered ComfyUI model has exactly one target.
- Produces external ids shaped as `COMFYUI:<targetId>:<type>:<uuid>`.
- Later tasks consume `COMFYUI_H3_RUNTIME_TARGET_ID = 'h3-dual-stage-2mp'` and the parsed `endpoint` field as the logical target id.

- [ ] **Step 1: Write the runtime-target and external-id RED tests**

Add this contract shape:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatComfyUiExternalId,
  parseComfyUiExternalId,
} from '@/lib/ai-providers/comfyui/external-id'

const PROMPT_ID = '00000000-0000-4000-8000-000000000001'

describe('ComfyUI external id protocol', () => {
  it('round-trips a target-aware H3 id', () => {
    const externalId = formatComfyUiExternalId({
      targetId: 'h3-dual-stage-2mp',
      type: 'VIDEO',
      requestId: PROMPT_ID,
    })
    expect(externalId).toBe(`COMFYUI:h3-dual-stage-2mp:VIDEO:${PROMPT_ID}`)
    expect(parseComfyUiExternalId(externalId)).toEqual({
      provider: 'COMFYUI',
      endpoint: 'h3-dual-stage-2mp',
      type: 'VIDEO',
      requestId: PROMPT_ID,
    })
  })

  it.each([
    `COMFYUI:VIDEO:${PROMPT_ID}`,
    `COMFYUI:unknown:VIDEO:${PROMPT_ID}`,
    `COMFYUI:shared:IMAGE:${PROMPT_ID}`,
    'COMFYUI:shared:VOICE:not-a-uuid',
  ])('rejects a non-canonical id: %s', (externalId) => {
    expect(() => parseComfyUiExternalId(externalId)).toThrow('Invalid COMFYUI externalId')
  })
})
```

In `comfyui-runtime-target-conformance.test.ts`, derive catalog model keys as
`comfyui::${model.modelId}`, compare the sorted list with `COMFYUI_REGISTERED_MODEL_KEYS`, and call
`resolveComfyUiRuntimeTargetIdForModelKey` for every key. Assert H3 resolves to `h3-dual-stage-2mp` and all three
audio modalities resolve to `shared`.

Extend `config.test.ts` to prove:

```ts
expect(resolveComfyUiRuntimeTarget('h3-dual-stage-2mp', {
  COMFYUI_H3_DUAL_STAGE_BASE_URL: ' http://127.0.0.1:8188/ ',
} as NodeJS.ProcessEnv)).toEqual({
  id: 'h3-dual-stage-2mp',
  baseUrl: 'http://127.0.0.1:8188',
})

expect(() => resolveComfyUiRuntimeTarget('h3-dual-stage-2mp', {
  COMFYUI_BASE_URL: 'http://127.0.0.1:8878',
} as NodeJS.ProcessEnv)).toThrow('COMFYUI_RUNTIME_TARGET_MISSING:h3-dual-stage-2mp')
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx.cmd vitest run tests/unit/ai-providers/comfyui/external-id.test.ts tests/unit/ai-providers/comfyui/config.test.ts tests/contracts/comfyui-runtime-target-conformance.test.ts
```

Expected: FAIL because the new module, target type, and resolver do not exist.

- [ ] **Step 3: Implement the typed runtime-target registry**

Replace the single global reader in `config.ts` with this public contract:

```ts
export const COMFYUI_RUNTIME_TARGET_IDS = [
  'shared',
  'h3-dual-stage-2mp',
] as const

export type ComfyUiRuntimeTargetId = (typeof COMFYUI_RUNTIME_TARGET_IDS)[number]

export type ComfyUiRuntimeTarget = {
  readonly id: ComfyUiRuntimeTargetId
  readonly baseUrl: string
}

export function resolveComfyUiRuntimeTarget(
  targetId: ComfyUiRuntimeTargetId,
  environment: NodeJS.ProcessEnv = process.env,
): ComfyUiRuntimeTarget
```

Use one exhaustive map:

```ts
const ENVIRONMENT_KEY_BY_TARGET: Record<ComfyUiRuntimeTargetId, string> = {
  shared: 'COMFYUI_BASE_URL',
  'h3-dual-stage-2mp': 'COMFYUI_H3_DUAL_STAGE_BASE_URL',
}
```

Retain the existing HTTP(S), no-credentials, no-query, no-hash normalization. Error codes must include the target id and must not read another target's environment key.

- [ ] **Step 4: Implement the pure external-id protocol**

`external-id.ts` must expose:

```ts
export type ComfyUiAsyncType = 'VIDEO' | 'MUSIC' | 'SOUND' | 'VOICE'

export function formatComfyUiExternalId(input: {
  readonly targetId: ComfyUiRuntimeTargetId
  readonly type: ComfyUiAsyncType
  readonly requestId: string
}): string

export function parseComfyUiExternalId(externalId: string): ParsedAsyncExternalId
```

Reject unknown targets, unsupported types, old three-part ids, extra fields, and non-UUID request ids. Do not put a physical URL into the external id.

- [ ] **Step 5: Make all ComfyUI submit/poll/cancel paths target-aware**

Use these fixed identities:

```ts
export const COMFYUI_SHARED_RUNTIME_TARGET_ID = 'shared' as const
export const COMFYUI_H3_RUNTIME_TARGET_ID = 'h3-dual-stage-2mp' as const
```

Every adapter submission must call `formatComfyUiExternalId`; no adapter may interpolate `COMFYUI:*` directly. Change poll/cancel signatures to accept a target id:

```ts
pollComfyUiH3Video(promptId, targetId)
cancelComfyUiH3Video(promptId, targetId)
pollComfyUiAceStepMusic(promptId, targetId)
pollComfyUiMossSound(promptId, targetId)
pollComfyUiMossTts(promptId, targetId)
```

H3 asserts `targetId === 'h3-dual-stage-2mp'`; audio implementations assert `targetId === 'shared'`. Each resolves its base URL once and reuses it for submit probe, poll, cancel, and output download. `async-task.ts` must dispatch both `parsed.type` and parsed `endpoint`; an absent endpoint is invalid.

- [ ] **Step 6: Make Planner connection preflight selected-model-aware**

Extend `getProviderConfig` without adding provider fallback:

```ts
export async function getProviderConfig(
  userId: string,
  providerId: string,
  modelKey?: string,
): Promise<ProviderConfig>
```

For a ComfyUI execution with a model key, resolve the model's declared runtime target and return that target URL. `preflightMediaGenerationOptions` must pass `selection.modelKey`. Calls that inspect the general ComfyUI provider without selecting a model may continue to inspect `shared`; model execution may not.

Expose the exhaustive resolver from `models.ts`:

```ts
export function resolveComfyUiRuntimeTargetIdForModelKey(
  modelKey: string,
): ComfyUiRuntimeTargetId
```

Define `COMFYUI_REGISTERED_MODEL_KEYS` from the four current model-key constants, derive
`ComfyUiRegisteredModelKey` from that tuple, and back the resolver with
`Record<ComfyUiRegisteredModelKey, ComfyUiRuntimeTargetId>`. Unknown strings throw
`COMFYUI_MODEL_RUNTIME_TARGET_UNKNOWN:<modelKey>`. Add a conformance assertion that the target-map keys equal the
production ComfyUI catalog keys, so a newly registered model cannot omit its runtime target.

Until Task 4 changes the model identity, map the current `comfyui::minimax-h3-fast` to `h3-dual-stage-2mp`. Task 4 atomically replaces that key. Map every current audio model to `shared`; unknown ComfyUI model keys fail instead of defaulting.

- [ ] **Step 7: Update environment and protocol messages**

Add to `.env.example`:

```dotenv
# Shared ComfyUI runtime for music, sound, TTS, and voice.
COMFYUI_BASE_URL=http://127.0.0.1:8878

# Dedicated MiniMax H3 dual-stage 2MP runtime.
COMFYUI_H3_DUAL_STAGE_BASE_URL=http://127.0.0.1:8188
```

Update the unsupported external-id error in `src/lib/ai-providers/index.ts` to show `COMFYUI:<target>:VIDEO|MUSIC|SOUND|VOICE:<promptId>`. Update test fixtures for audio external ids to use `shared`.

Use `apply_patch` to add the same H3 variable to the ignored local `.env`. Preserve the existing
`COMFYUI_BASE_URL=http://127.0.0.1:8878/` shared runtime and do not stage or print the rest of `.env`.

- [ ] **Step 8: Run Task 1 verification**

Run:

```powershell
npx.cmd vitest run tests/unit/ai-providers/comfyui/external-id.test.ts tests/unit/ai-providers/comfyui/config.test.ts tests/unit/ai-providers/comfyui-async-task.test.ts tests/contracts/comfyui-runtime-target-conformance.test.ts tests/contracts/comfyui-ace-step-music.contract.test.ts tests/contracts/comfyui-moss-soundeffect.contract.test.ts tests/contracts/comfyui-moss-tts.contract.test.ts
npx.cmd eslint src/lib/ai-providers/comfyui src/lib/ai-exec/media-preflight.ts src/lib/user-api/runtime-config.ts tests/unit/ai-providers/comfyui
```

Expected: all focused tests pass; no production `COMFYUI:VIDEO:`, `COMFYUI:MUSIC:`, `COMFYUI:SOUND:`, or `COMFYUI:VOICE:` interpolation remains.

- [ ] **Step 9: Commit the runtime-identity protocol**

```powershell
git add src/lib/ai-providers src/lib/ai-exec/media-preflight.ts src/lib/user-api/runtime-config.ts tests .env.example
git commit -m "refactor(comfyui): isolate runtime targets"
```

Do not include `.superpowers/` or unrelated files.

---

### Task 2: Add the six-section reference Prompt dialect and deterministic gate

**Files:**
- Create: `src/lib/video-generation/h3-reference-prompt.ts`
- Create: `tests/unit/video-generation/h3-reference-prompt.test.ts`
- Modify: `src/lib/ai-registry/types.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/creative-skills/skills/video-direction/SKILL.md`
- Modify: `src/lib/creative-skills/registry.ts`
- Modify: `tests/contracts/video-prompt-profile-validator-conformance.test.ts`
- Modify: `tests/contracts/project-production-prompt-profile-conformance.test.ts` only after Task 4 switches the production model; in this task add v2 validator coverage without changing the current model expectation

**Interfaces:**
- Produces: `VideoPromptProfile` value `minimax_h3_reference_v2`.
- Produces: `assertVideoPromptMatchesProfile({ profile, prompt }): void` as the sole deterministic Prompt structure gate.
- Task 4 consumes the new profile from the H3 capability entry.

- [ ] **Step 1: Invoke the required Skill-authoring workflow**

Read and follow `superpowers:writing-skills`. Record a baseline from the current `video-direction` using one reference-image H3 scenario: the old Skill should either choose a frame mode or emit the three-section `minimax_h3_v1` dialect, proving the new six-section behavior is not already present.

- [ ] **Step 2: Write the Prompt contract RED test**

Add this independent structural oracle:

```ts
import { describe, expect, it } from 'vitest'
import { assertVideoPromptMatchesProfile } from '@/lib/video-generation/h3-reference-prompt'

const validPrompt = `subject_definitions:
<Subject 1> is the woman in <Picture 1>.

summary:
She turns toward the doorway.

retention_analysis:
Preserve her identity, clothing, and the room layout from <Picture 1>.

detailed_description:
At 0.00 seconds she notices the doorway, turns, and settles facing it.

overall_soundscape:
Soft room tone, fabric movement, and her quiet breath.

non_diegetic_music:
None. Do not generate background music or musical score.
Retain only dialogue, environmental ambience and action sound effects.`

describe('MiniMax H3 reference Prompt contract', () => {
  it('accepts the exact six ordered sections and no-background-music clause', () => {
    expect(() => assertVideoPromptMatchesProfile({
      profile: 'minimax_h3_reference_v2',
      prompt: validPrompt,
    })).not.toThrow()
  })

  it.each([
    validPrompt.replace('retention_analysis:', 'retention_notes:'),
    validPrompt.replace('summary:\nShe turns toward the doorway.\n\n', 'summary:\n\n'),
    validPrompt.replace('Do not generate background music or musical score.', 'Use a dramatic orchestral score.'),
  ])('rejects an invalid reference Prompt', (prompt) => {
    expect(() => assertVideoPromptMatchesProfile({
      profile: 'minimax_h3_reference_v2',
      prompt,
    })).toThrow('VIDEO_PROMPT_PROFILE_INVALID')
  })
})
```

Also update `video-prompt-profile-validator-conformance.test.ts` so `minimax_h3_reference_v2` is accepted. Keep `minimax_h3_v1` temporarily accepted only until Task 4 hard cutover.

- [ ] **Step 3: Run the focused tests and verify RED**

```powershell
npx.cmd vitest run tests/unit/video-generation/h3-reference-prompt.test.ts tests/contracts/video-prompt-profile-validator-conformance.test.ts
```

Expected: FAIL because v2 and the validator do not exist.

- [ ] **Step 4: Implement one exhaustive Prompt validator**

Use these exact headings:

```ts
export const MINIMAX_H3_REFERENCE_PROMPT_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const
```

`assertVideoPromptMatchesProfile` must:

- no-op for `generic_v1` and the temporarily retained `minimax_h3_v1`;
- for v2, find each exact heading once, in order, at line start;
- require non-whitespace body text between headings;
- reject an unknown lowercase underscore-only top-level heading;
- require the final body to contain `Do not generate background music or musical score.` and the permitted-audio sentence;
- throw `VIDEO_PROMPT_PROFILE_INVALID:<reason>` without rewriting Prompt text.

Call it from `generation-ops.ts` after the model capability and final Prompt are known but before `preflightMediaGenerationOptions` and before Task/resource persistence. Dispatch by capability `promptProfile`, never by model name.

- [ ] **Step 5: Add the v2 dialect to the sole video Skill**

Keep the current general directing, timeline, continuity, vocal-performance, and 4–15 second rules. Add `minimax_h3_reference_v2` as a separate final expression dialect with this exact order:

```text
subject_definitions
summary
retention_analysis
detailed_description
overall_soundscape
non_diegetic_music
```

Require exactly one `reference_image` mapped to `<Picture 1>`. State that it preserves identity/style/content but is not a first frame. Require the exact no-background-music clause and keep dialogue/ambience/action sound in `overall_soundscape`. Explicitly forbid the ComfyUI AI node or any downstream Prompt rewriting. Increment `video-direction` from `4.3.0` to `4.4.0`.

- [ ] **Step 6: Run Skill pressure scenarios**

Materialize the runtime Skill and manually evaluate these cases without adding brittle prose-string tests:

1. One character reference image, 4-second action, native dialogue: six sections, one `<Picture 1>`, exact dialogue, no BGM.
2. Reference image differs from desired first pose: treats it as identity/style reference, not a time-zero frame.
3. User requests dramatic music inside H3: keeps `non_diegetic_music` disabled and leaves BGM to the music workflow.
4. Missing reference resource: stops instead of changing to text-to-video or first-frame mode.

- [ ] **Step 7: Run Task 2 verification and commit**

```powershell
npx.cmd vitest run tests/unit/video-generation/h3-reference-prompt.test.ts tests/contracts/video-prompt-profile-validator-conformance.test.ts tests/contracts/video-direction-runtime-skill.contract.test.ts
npx.cmd eslint src/lib/video-generation/h3-reference-prompt.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/ai-registry/types.ts tests/unit/video-generation/h3-reference-prompt.test.ts
git add src/lib/video-generation src/lib/ai-registry/types.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/creative-skills tests/unit/video-generation tests/contracts/video-prompt-profile-validator-conformance.test.ts
git commit -m "feat(video): add H3 reference prompt profile"
```

The commit may contain the v2 dialect before production selects it; it must not expose a second executable H3 model or workflow.

---

### Task 3: Canonicalize and prove the dual-stage API graph

**Files:**
- Create: `src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json`
- Modify: `src/lib/ai-providers/comfyui/profiles.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`

**Interfaces:**
- Produces: `H3_DUAL_STAGE_PROFILE_ID = 'h3-dual-stage-2mp'`.
- Produces: `H3_DUAL_STAGE_RUNTIME_PROFILE`, `resolveH3Dimensions({ megapixels, aspectRatio })`, `resolveH3DurationFrames(seconds)`, and `buildH3DualStagePromptGraph(input)`.
- Task 4 switches the production H3 executor to these exports and deletes the legacy profiles.

Define the profile metadata explicitly:

```ts
export type H3DualStageRuntimeProfile = {
  readonly id: typeof H3_DUAL_STAGE_PROFILE_ID
  readonly workflow: ComfyUiPromptGraph
  readonly referenceImageNodeId: string
  readonly h3NodeId: string
  readonly noiseNodeId: string
  readonly firstUpscaleNodeId: string
  readonly finalUpscaleNodeId: string
  readonly outputNodeId: string
  readonly requiredNodeClasses: readonly string[]
}
```

- [ ] **Step 1: Replace the profile test with a RED dual-stage graph oracle**

Keep the existing duration expectations `4 -> 107`, `5 -> 124`, `10 -> 243`, `15 -> 362`. Replace 480p/720p dimension assertions with:

```ts
expect(resolveH3Dimensions({ megapixels: 1, aspectRatio: '16:9' }))
  .toEqual({ width: 1376, height: 768 })
expect(resolveH3Dimensions({ megapixels: 2, aspectRatio: '16:9' }))
  .toEqual({ width: 1920, height: 1088 })
```

Add production-graph assertions:

```ts
const graph = H3_DUAL_STAGE_RUNTIME_PROFILE.workflow
const nodes = Object.values(graph)
expect(nodes.some((node) => node.class_type === 'RH_CODEX_NODE')).toBe(false)
expect(nodes.some((node) => node.class_type === 'LoadImage')).toBe(false)
expect(nodes.filter((node) => node.class_type === 'easy clearCacheAll')).toHaveLength(2)
expect(nodes.filter((node) => node.class_type === 'ImageResizeKJv2' && node.inputs.upscale_method === 'nvidia_rtx_vsr')).toHaveLength(2)
expect(nodes.find((node) => node.class_type === 'MiniMaxH3ReferenceToVideo')).toBeTruthy()
expect(nodes.filter((node) => node.class_type === 'UNETLoader').map((node) => node.inputs.unet_name)).toEqual(expect.arrayContaining([
  'h3\\minimax_h3_ref2va_int8_convrot.safetensors',
  'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors',
]))
```

Add a graph-link oracle that walks every `[nodeId, outputIndex]` input and rejects references to absent nodes. Assert exactly one final `VHS_VideoCombine`, its frame rate is 24, format is H.264 MP4, CRF is 10, and its audio input traces to first-stage `VAEDecodeAudio`.

- [ ] **Step 2: Run the profile test and verify RED**

```powershell
npx.cmd vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts
```

Expected: FAIL because the dual-stage profile and graph are absent and dimensions still accept resolution names.

- [ ] **Step 3: Build the canonical API JSON from the approved UI graph**

Use the source file at the approved absolute path and live 8188 `/object_info` definitions. Preserve these core UI node identities while converting them to API inputs:

| UI id | Required API role |
| ---: | --- |
| 119, 120 | video/audio VAE loaders |
| 121, 122 | first-stage audio/video decode |
| 123, 124, 125, 126, 127, 128, 129 | first-stage Euler sampling chain |
| 162 | first cache clear |
| 168 | only final H.264 MP4 combine |
| 198 | reference shortest-edge resize at 1072 |
| 213 | 1MP `nvidia_rtx_vsr` resize |
| 216, 219, 221 | AV latent join and VAE re-encode |
| 222, 223, 224, 232 | second-stage 3-step, 0.2-denoise sampling chain |
| 225 | second-stage video decode |
| 286 | second cache clear |
| 304, 305 | `comfy kitchen attention` for each model |
| 306 | second UNET loader |
| 309 | `MiniMaxH3ReferenceToVideo` |
| 320 | 8-step v1.0 Turbo LoRA loader |
| 323 | final 2MP `nvidia_rtx_vsr` resize |

Add one URL loader node using `Load Image From Url (mtb)` before node 198. Remove `RH_CODEX_NODE`, local `LoadImage`, `ResolutionSelector`, `Primitive*`, `INTConstant`, `ComfyMathExpression`, `StringFunction|pysssss`, `easy showAnything`, every `SetNode/GetNode`, and the preview-only `VHS_VideoCombine` with `save_output=false`.

Hard-code immutable workflow values in the API graph: LoRA strength 1, attention backend, samplers, schedulers, CRF/pixel format, reference `ref_image_size='max'`, and cache ordering. Dynamic Prompt, URL, lengths, dimensions, and seed remain builder injection points.

- [ ] **Step 4: Implement the pure profile builder**

Use this input contract:

```ts
export function buildH3DualStagePromptGraph(input: {
  readonly prompt: string
  readonly referenceImageUrl: string
  readonly durationSeconds: number
  readonly aspectRatio: H3AspectRatio
  readonly seed: number
}): {
  readonly profile: H3DualStageRuntimeProfile
  readonly graph: ComfyUiPromptGraph
}
```

Clone every node and `inputs` object before mutation. Inject:

- reference URL into the declared URL-loader node;
- Prompt, 1MP width/height, aligned length, and `ref_image_size='max'` into `MiniMaxH3ReferenceToVideo`;
- the same stable seed into the declared noise node used by both stages;
- 1MP dimensions into node 213 and 2MP dimensions into node 323;
- no `resolution`, local filename, last-frame, or AI-node values.

Reject empty Prompt/URL, unsafe seed, unsupported aspect ratio, and duration outside 4–15.

- [ ] **Step 5: Run profile verification and commit the unreachable candidate graph**

```powershell
npx.cmd vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts
npx.cmd eslint src/lib/ai-providers/comfyui/profiles.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
git add src/lib/ai-providers/comfyui/profiles.ts src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json tests/contracts/comfyui-h3-profile-conformance.test.ts
git commit -m "feat(comfyui): add H3 dual-stage API profile"
```

At this checkpoint the candidate graph exists but production still selects the legacy executor/profile. This temporary non-executable overlap is removed in Task 4; do not deploy between Tasks 3 and 4.

---

### Task 4: Hard-cut production H3 to reference-only dual-stage execution

**Files:**
- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `src/lib/ai-providers/comfyui/h3.ts`
- Modify: `src/lib/ai-providers/comfyui/profiles.ts`
- Modify: `src/lib/ai-providers/comfyui/transport.ts`
- Modify: `src/lib/ai-registry/types.ts`
- Modify: `src/lib/creative-skills/skills/video-direction/SKILL.md`
- Delete: both legacy H3 workflow JSON files
- Modify: `tests/integration/provider/comfyui-h3-submission.contract.test.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`
- Modify: `tests/contracts/project-production-prompt-profile-conformance.test.ts`
- Modify: all production-conformance fixtures found by `rg "minimax-h3-fast|minimax_h3_v1" tests src .env.example`
- Modify: `.env.example`, `tests/setup/env.ts`

**Interfaces:**
- Produces: `COMFYUI_H3_MODEL_ID = 'minimax-h3-dual-stage-2mp'` and model key `comfyui::minimax-h3-dual-stage-2mp`.
- Produces one runtime profile and one H3 submit/poll/cancel implementation bound to `h3-dual-stage-2mp`.
- Removes `minimax_h3_v1`, both frame modes, both old workflows, and all 480p/720p behavior.

- [ ] **Step 1: Rewrite the provider submission tests to describe the new contract and verify RED**

Change the fixture to:

```ts
const videoInput: AiProviderVideoExecutionContext = {
  userId: 'user-h3-contract',
  selection: {
    provider: 'comfyui',
    modelId: 'minimax-h3-dual-stage-2mp',
    modelKey: 'comfyui::minimax-h3-dual-stage-2mp',
    variantSubKind: 'official',
  },
  imageUrl: '',
  options: {
    prompt: VALID_H3_REFERENCE_PROMPT,
    duration: 4,
    aspectRatio: '16:9',
    generateAudio: true,
    referenceImages: ['https://media.example.com/reference.png'],
  },
}
```

Define `VALID_H3_REFERENCE_PROMPT` in this test file using the same complete six-section valid example from Task 2;
do not import a production constant containing Prompt prose.

Required contract cases:

- exactly one reference image succeeds through local graph validation;
- zero, two, first-frame, last-frame, reference-audio, reference-video, `resolution`, or `generateAudio=false` are pre-accept rejected before `/prompt`;
- graph submission contains both exact UNETs, both RTX VSR nodes, two cache clears, final output node, the exact reference URL and Prompt, and no Codex node;
- a 400 stays rejected; 408/5xx probe the same prompt id on the H3 target and never shared;
- accepted result external id equals `COMFYUI:h3-dual-stage-2mp:VIDEO:<promptId>`;
- poll only accepts the profile-declared final node;
- `MAX_VIDEO_BYTES + 1` is rejected, while the old private 100MB constant is absent;
- wrong MIME/container fails before persistence.

Run the two H3 suites and confirm they fail against the legacy implementation.

- [ ] **Step 2: Switch model identity and capability atomically**

In `models.ts` declare:

```ts
export const COMFYUI_H3_MODEL_ID = 'minimax-h3-dual-stage-2mp'
export const COMFYUI_H3_DEFAULT_GENERATION_OPTIONS = {
  generateAudio: true,
} as const satisfies Record<string, CapabilityValue>
```

The video capability must be:

```ts
video: {
  promptProfile: 'minimax_h3_reference_v2',
  supportedInputModes: ['reference'],
  supportsTextToVideo: false,
  durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  generateAudioOptions: [true],
  supportGenerateAudio: true,
  assetReferenceMultiReference: false,
  maxReferenceImages: 1,
  maxReferenceFiles: 1,
}
```

Do not declare `resolutionOptions`, `firstlastframe`, `maxReferenceAudios`, or `maxReferenceVideos`. Use the user-visible name `MiniMax H3 Dual-Stage 2MP` in the API config catalog and platform preset.

- [ ] **Step 3: Replace the adapter option schema**

Remove `resolution` from allowed/required options. Allow `referenceImages` using `stringArrayValidator({ maxLength: 1 })`; keep it required via an object validator that demands exactly one entry. Exclude `lastFrameImageUrl`, `referenceAudios`, and `referenceVideos`. Require `duration`, `aspectRatio`, and `generateAudio`, and add an object validator that requires `generateAudio === true` and exact new model identity.

The normalized options sent to H3 must contain no quality selector; profile code owns 1MP/2MP.

- [ ] **Step 4: Replace H3 build, preflight, submit, poll, and cancel**

`buildGraph` must:

- require the exact model selection;
- require `options.referenceImages` length 1 and `input.imageUrl === ''`;
- reject last frame/audio/video references and unknown quality options through the adapter schema;
- derive a stable integer seed from the pre-generated prompt id;
- call `buildH3DualStagePromptGraph` with Prompt, reference URL, duration, aspect ratio, and seed.

H3 preflight must query the H3 target and verify:

- every required class declared by the single runtime profile;
- both UNET names, CLIP, both VAEs, and `LoraLoaderModelOnly` LoRA;
- `ImageResizeKJv2.upscale_method` includes `nvidia_rtx_vsr`;
- `ModelAttentionBackend.attention` includes `comfy kitchen attention`.

Submission returns the four-part H3 external id. Probe, poll, cancel, and `/view` all receive the same resolved base URL; no function calls the shared URL reader.

- [ ] **Step 5: Add exact-node video output extraction and the shared 512MB bound**

Add a reusable transport function analogous to the existing declared-node audio reader:

```ts
export function readComfyUiDeclaredNodeVideoOutput(
  value: unknown,
  expectedNodeId: string,
): ComfyUiOutput | null
```

It must inspect only `record[expectedNodeId]` (or an envelope explicitly declaring that node id), accept one `.mp4` entry from `gifs`, `videos`, or `files`, and reject any other node or extension. H3 poll calls it with the profile output node id and downloads with `maxBytes: MAX_VIDEO_BYTES` imported from the shared body-size constants.

- [ ] **Step 6: Delete legacy production paths**

Delete both old workflow JSONs and all old profile ids, imports, frame-node metadata, `H3Resolution`, `resolveProfile`, `lastFrameUrl`, and `MiniMaxH3ImageToVideo` branches. Remove `minimax_h3_v1` from `VIDEO_PROMPT_PROFILES` and remove its old dialect from `video-direction`; v2 and `generic_v1` remain.

Remove the temporary `minimax_h3_v1` no-op case from `assertVideoPromptMatchesProfile` at the same time, so its switch remains exhaustive over the final two profile values.

Update `.env.example` and `tests/setup/env.ts` default model strings. Update fixture-only old model keys only where the fixture still represents a currently valid production model; do not add an alias.

- [ ] **Step 7: Prove the Planner accepts only one ordinary reference image**

Update the relevant workspace-resource operation conformance case to build one `channel='image', role='reference_image'` reference and the six-section Prompt. Assert planning succeeds with the new model key. Add or update rejection cases for:

- no reference (`text_to_video` unsupported);
- `first_frame` and `first_last_frame` modes;
- two `reference_image` entries;
- any reference audio/video.

Use the existing production capability resolver as oracle; do not mock the Planner or assert call counts.

- [ ] **Step 8: Run focused cutover verification**

```powershell
npx.cmd vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts tests/contracts/video-prompt-profile-validator-conformance.test.ts tests/contracts/project-production-prompt-profile-conformance.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts tests/unit/video-generation/reference-images.test.ts tests/unit/video-generation/h3-reference-prompt.test.ts
npm.cmd run check:capability-catalog
npm.cmd run env:platform-models:check
npx.cmd eslint src/lib/ai-providers/comfyui src/lib/ai-registry/types.ts src/lib/video-generation src/lib/operations/domains/workspace-resource/generation-ops.ts tests/contracts tests/integration/provider/comfyui-h3-submission.contract.test.ts
```

Expected: all pass. Then run:

```powershell
rg -n "minimax-h3-fast|minimax_h3_v1|h3-fast-first-frame|h3-fast-first-last-frame|MiniMaxH3ImageToVideo|COMFYUI:(VIDEO|MUSIC|SOUND|VOICE):" src tests .env.example
```

Expected: no matches. References in already committed historical design documents are allowed and must not be rewritten.

- [ ] **Step 9: Commit the hard cutover**

```powershell
git add src tests .env.example
git commit -m "feat(video): replace H3 with dual-stage 2MP workflow"
```

Review the staged deletion list before committing; only the two legacy H3 workflow JSON files may be deleted.

---

### Task 5: Verify the real 8188 runtime and final media

**Files:**
- No committed production files unless verification finds a real defect.
- Temporary ignored file allowed: `.tmp-h3-live-smoke.ts`, created and removed with `apply_patch`.
- Generated ignored artifact: `.runtime/h3-smoke-4s.mp4`.

**Interfaces:**
- Consumes the production H3 adapter, four-part async registry, and configured H3 target.
- Produces evidence for one actual 4-second dual-stage job, final MP4 metadata, native audio, and target isolation.

- [ ] **Step 1: Re-run fresh live capability checks**

Query `http://127.0.0.1:8188/system_stats`, `/queue`, and `/object_info` for every required node. Re-read model option arrays and confirm the exact two UNETs, CLIP, VAEs, LoRA, `nvidia_rtx_vsr`, and `comfy kitchen attention`. Do not reuse the design-time snapshot.

Also verify that the `.env` used by Wao contains `COMFYUI_H3_DUAL_STAGE_BASE_URL=http://127.0.0.1:8188`; do not print secrets or the whole environment.

- [ ] **Step 2: Select a real reference URL without creating a second product route**

Prefer a signed MinIO URL produced by the existing owner-aware image projection. If no suitable WorkspaceResource exists, confirm that the workflow's current input image exists in ComfyUI and use its bounded local `/view?type=input&filename=...` URL only for this provider smoke. Record which source was used; do not persist it as a product default.

- [ ] **Step 3: Create a temporary smoke harness that calls production exports**

Using `apply_patch`, create ignored `.tmp-h3-live-smoke.ts` with this structure:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { executeComfyUiH3VideoGeneration } from './src/lib/ai-providers/comfyui/h3'
import { COMFYUI_H3_MODEL_ID } from './src/lib/ai-providers/comfyui/models'
import { waitForAsyncProviderResult } from './src/lib/ai-exec/async-wait'

const referenceUrl = process.env.H3_SMOKE_REFERENCE_URL?.trim() || ''
if (!referenceUrl) throw new Error('H3_SMOKE_REFERENCE_URL_REQUIRED')

const prompt = `subject_definitions:
<Subject 1> is the person in <Picture 1>.

summary:
The subject turns toward a nearby doorway and settles.

retention_analysis:
Preserve identity, clothing, proportions, and scene structure from <Picture 1>.

detailed_description:
At 0.00 seconds the subject notices the doorway, turns naturally, and reaches a stable final pose.

overall_soundscape:
Quiet room ambience, fabric movement, footsteps, and breathing.

non_diegetic_music:
None. Do not generate background music or musical score.
Retain only dialogue, environmental ambience and action sound effects.`

const result = await executeComfyUiH3VideoGeneration({
  userId: 'local-h3-smoke',
  selection: {
    provider: 'comfyui',
    modelId: COMFYUI_H3_MODEL_ID,
    modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`,
    variantSubKind: 'official',
  },
  imageUrl: '',
  options: {
    referenceImages: [referenceUrl],
    duration: 4,
    aspectRatio: '16:9',
    generateAudio: true,
    prompt,
  },
})

if (!result.externalId) throw new Error('H3_SMOKE_EXTERNAL_ID_MISSING')
const completed = await waitForAsyncProviderResult({
  externalId: result.externalId,
  userId: 'local-h3-smoke',
  intervalMs: 5_000,
})
if (!completed.url.startsWith('data:video/mp4;base64,')) throw new Error('H3_SMOKE_MP4_MISSING')
const bytes = Buffer.from(completed.url.slice(completed.url.indexOf(',') + 1), 'base64')
await mkdir(path.resolve('.runtime'), { recursive: true })
await writeFile(path.resolve('.runtime/h3-smoke-4s.mp4'), bytes)
process.stdout.write(JSON.stringify({ externalId: result.externalId, bytes: bytes.length }))
```

This is a verification harness over production exports, not a committed second execution path.

- [ ] **Step 4: Run the real 4-second generation**

```powershell
npx.cmd tsx --env-file=.env .tmp-h3-live-smoke.ts
```

Expected evidence:

- one external id with target `h3-dual-stage-2mp`;
- one 8188 prompt id, no request to the shared ComfyUI runtime;
- queue moves pending -> in_progress -> completed;
- history contains the declared final output node;
- output size is greater than zero and at most 512MB;
- no intermediate 1MP result is returned as the product URL.

- [ ] **Step 5: Inspect the final media**

Use the bundled ffprobe path from `ffmpeg-ffprobe-static` against `.runtime/h3-smoke-4s.mp4`. Confirm:

- container is MP4 and video codec is H.264;
- pixel format is YUV420P;
- frame rate is 24fps;
- frame dimensions are the 32-aligned 2MP `16:9` dimensions from the profile;
- at least one audio stream exists;
- reported duration matches the H3 aligned-frame output rather than assuming exactly 4.000 seconds.

Listen to or render the produced media in the Codex app only if needed for human review. Confirm audible dialogue/ambience/action sound is allowed and no background musical score is present. Automated metadata cannot prove absence of music; report this as human observation.

- [ ] **Step 6: Exercise target-aware cancellation with minimal GPU cost**

Submit a second 4-second prompt, persist its four-part external id in the temporary harness, and immediately call `cancelAsyncTask(externalId, 'local-h3-smoke')`. Confirm `/api/jobs/:id/cancel` is sent only to 8188 and the provider reports cancelled/terminal. Do not interpret this as proof of Wao terminal-owner ordering; that ordering remains covered by existing Task lifecycle contracts.

- [ ] **Step 7: Remove the temporary harness and record blind spots**

Delete `.tmp-h3-live-smoke.ts` with `apply_patch`. Keep the generated `.runtime` MP4 only long enough for user inspection; it is ignored and not committed. Do not delete it without telling the user.

If a real 15-second generation is not run, explicitly record: “15-second dimensions/frame graph validated statically; 15-second peak VRAM, wall time, output size, and Worker Base64 memory not live-verified.”

---

### Task 6: Final repository verification, review, and handoff

**Files:**
- Verify all changed files from Tasks 1–4.
- Modify only defects found by verification; no opportunistic refactors.

**Interfaces:**
- Consumes all prior task outputs.
- Produces a reviewable branch with no legacy H3 execution path and an evidence-backed completion boundary.

- [ ] **Step 1: Run the complete affected verification set**

```powershell
npm.cmd run test:logic
npm.cmd run test:conformance
npm.cmd run test:critical:provider
npm.cmd run typecheck
npm.cmd run check:capability-catalog
npm.cmd run env:platform-models:check
npm.cmd run security:secrets:repo
```

If a suite has a known unrelated baseline failure, keep the focused H3 evidence separate and report the exact failing command/output; do not modify production code to satisfy a stale fixture.

- [ ] **Step 2: Re-audit production references and graph invariants**

Run:

```powershell
rg -n "minimax-h3-fast|minimax_h3_v1|h3-fast-first-frame|h3-fast-first-last-frame|MiniMaxH3ImageToVideo|RH_CODEX_NODE|COMFYUI:(VIDEO|MUSIC|SOUND|VOICE):" src tests .env.example
rg -n "readComfyUiBaseUrl" src/lib/ai-providers/comfyui src/lib/user-api
git status --short
git diff --check "$h3ImplementationBase..HEAD"
```

Expected: no legacy production matches, no direct H3 global URL read, no whitespace errors, and only task-owned commits/files. Historical design docs may retain old terms as evidence.

- [ ] **Step 3: Perform the required code review**

Invoke `superpowers:requesting-code-review`. Review specifically:

- runtime target cannot drift between submit/poll/cancel/download;
- external id parser has no legacy branch;
- one reference image is never promoted to first frame;
- Prompt validation is profile-driven and has one parser;
- graph contains both cache clears and no hidden Codex call;
- second-stage audio/video latent connection and final first-stage audio mux are correct;
- final-node reader cannot select preview/intermediate output;
- 512MB is bounded and the 100MB H3 constant is gone;
- old model/workflow/profile paths are deleted rather than aliased.

Fix confirmed findings with focused verification and separate commits; do not accept review suggestions without evidence.

- [ ] **Step 4: Update completion status and present integration choices**

Use `superpowers:verification-before-completion` to verify fresh output, then `superpowers:finishing-a-development-branch` to offer merge/push/worktree choices. Report:

- authoritative model, Prompt, runtime target, submission, async lifecycle, output, and persistence owners;
- deleted old profiles/workflows and old external-id protocol;
- writer/entry/state-interpreter counts before and after;
- actual commands and pass/partial/fail results;
- 8188 job id, output path, media metadata, and human no-BGM observation;
- any unverified 15-second or Base64-memory boundary;
- confirmation that no database/media cleanup occurred.
