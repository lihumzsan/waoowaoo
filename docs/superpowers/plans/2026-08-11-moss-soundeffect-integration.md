# MOSS SoundEffect Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the verified local MOSS-SoundEffect-v2 ComfyUI workflow as Wao's first-class `sound` modality for 1–30 second MP3 environmental sound effects, while keeping `create_audio` and the existing audio task lifecycle as the only execution and terminal-write path.

**Architecture:** Add `sound` to the exhaustive model/capability/pricing registries and add `soundModel` to project/user configuration. Upgrade the `create_audio` request to a strict `audioKind: 'music' | 'sound'` union, freeze the discriminator and selected model into one task payload, and branch once inside the existing audio handler. The ComfyUI adapter submits a repository-owned MOSS API graph, tracks `COMFYUI:SOUND:<promptId>`, and materializes only the declared MP3 output through the shared audio artifact writer. There is no TTS, automatic mix, hidden prompt rewriting, model auto-download, provider fallback, second route, second task type, or second terminal writer.

**Tech Stack:** TypeScript, Zod, Prisma, Temporal, MinIO, MySQL, ComfyUI HTTP API, MOSS-SoundEffect-v2, Vitest contract tests, PowerShell/npm scripts.

## Global Constraints

- The approved design at `docs/superpowers/specs/2026-08-11-moss-soundeffect-integration-design.md` is authoritative. Stop if implementation requires a different owner, writer, discriminator, schema identity, provider fallback, input reference, or duration/output contract.
- `create_audio` remains the sole public operation. `TASK_TYPE.WORKSPACE_RESOURCE_AUDIO`, `workspace-resource-audio.ts`, the shared artifact materializer, and the existing workspace-resource persistence path remain the sole task, handler, and terminal writer.
- `audioKind` is exactly `music | sound`. Do not introduce `environment`, infer kind from prompt/model/schema, or default a missing kind.
- The sound schema identity is exactly `project.sound_effect_audio`; music remains `project.bgm_audio`.
- The MOSS adapter sends the already-final `prompt` and optional `negativePrompt` verbatim. Do not append duration, quality tags, translations, or negative terms.
- Sound accepts no image/video/audio references, produces MP3 only, and accepts integer `durationSeconds` from 1 through 30.
- Runtime workflow nodes are explicit and fail closed. `auto_download` must be false, compile disabled, output node fixed, and missing class/model/output must fail before or at the provider boundary.
- Do not execute a Prisma migration or mutate an existing database until the user separately authorizes the exact local database target. Creating and checking the migration file is allowed.
- Preserve unrelated dirty changes. Before every task, inspect `git status --short` and `git diff -- <task files>`; stage only files owned by that task.
- Follow repository test governance. Add tests only for registry-derived conformance or real ComfyUI protocol boundaries. Do not add mock call-count, snapshot, source-string, or duplicated-implementation tests.
- After every code task, run the focused verification listed for that task. Before claiming completion, run the full verification in Task 8 and use `superpowers:verification-before-completion` plus `verify-after-code-change`.

---

## Task 1: Add the exhaustive `sound` modality, capability, and pricing contract

**Files:**

- Modify: `src/lib/ai-registry/types.ts`
- Modify: `src/lib/ai-registry/model-contracts.ts`
- Modify: `src/lib/ai-registry/api-config-catalog.ts`
- Modify: `src/lib/ai-registry/pricing-catalog.ts`
- Modify: `src/lib/ai-registry/pricing-retail.ts`
- Modify: `src/lib/ai-providers/runtime-types.ts`
- Modify: `src/lib/ai-providers/shared/option-schema.ts`
- Modify: `src/lib/ai-exec/engine.ts`
- Modify: `src/lib/ai-exec/media-observe.ts`
- Modify: `src/lib/ai-exec/media-preflight.ts`
- Modify: `src/lib/billing/cost.ts`
- Modify: `src/lib/billing/service.ts`
- Modify: `src/lib/profile/billing-transaction-display.ts`
- Modify: `src/lib/user-api/api-config-defaults.ts`
- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `scripts/check-model-config-contract.mjs`

- [ ] **Step 1: Extend every closed modality/model union.**

Add `sound` to `AiModality`, `UnifiedModelType`, provider adapter modality maps, option-schema maps, preflight maps, media observation, and every exhaustive switch. Use a dedicated capability shape rather than treating sound as music:

```ts
export interface SoundCapabilities {
  durationSecondsRange?: {
    min: number
    max: number
  }
  outputFormatOptions?: string[]
  promptMaxChars?: number
  fieldI18n?: CapabilityFieldI18nMap
}

export type AiProviderSoundExecutionContext = {
  userId: string
  selection: AiResolvedSelection & {
    provider: string
    modelId: string
    modelKey: string
  }
  prompt: string
  options?: {
    negativePrompt?: string
    durationSeconds?: number
    outputFormat?: 'mp3'
    [key: string]: unknown
  }
}
```

Add `sound?: SoundCapabilities` to `ModelCapabilities`, `sound?: AiProviderMediaModalityAdapter<'sound'>` to provider adapters, and make `AiProviderMediaModalityAdapter` accept `'image' | 'video' | 'music' | 'sound' | 'voice'`.

- [ ] **Step 2: Add the execution contract without adding a provider fallback.**

Add this engine option and union member:

```ts
export interface AiSoundExecutionOptions {
  negativePrompt?: string
  durationSeconds: number
  outputFormat: 'mp3'
}

// Add this member to the existing AiMediaExecutionInput union.
{
  modality: 'sound'
  userId: string
  modelKey: string
  prompt: string
  options?: AiSoundExecutionOptions
}
```

Implement `generateSound()` through the same provider-route resolution, option validation, observation, async wait, and billing hooks as other media modalities. Missing `provider.sound` must fail with the existing unsupported-modality error; do not retry as music.

- [ ] **Step 3: Add `sound` pricing as an explicit API type.**

Extend `PricingApiType` and retail markup records with `sound`. Add `calcSound(model, quantity, metadata)` parallel to `calcMusic`, and add the billing-service and transaction-display branches. The calculation must query `apiType: 'sound'`; never reuse `music` rows.

- [ ] **Step 4: Register the MOSS model identity and zero-cost local price.**

In `comfyui/models.ts`, add one model with stable key and an explicit sound capability:

```ts
export const COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID = 'moss-soundeffect-v2'
export const COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY =
  `comfyui::${COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID}`

// Add to COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.
{
  provider: 'comfyui',
  modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID,
  modelType: 'sound',
  capabilities: {
    sound: {
      durationSecondsRange: { min: 1, max: 30 },
      outputFormatOptions: ['mp3'],
    },
  },
}

// Add to COMFYUI_BUILTIN_PRICING_CATALOG_ENTRIES.
{
  apiType: 'sound',
  provider: 'comfyui',
  modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID,
  cost: ZERO_PRICE,
  retail: ZERO_PRICE,
}
```

Use the actual field names required by `AiModelDefinition` and existing ComfyUI declarations; do not add capability fields that cannot be supported by the verified runtime.

- [ ] **Step 5: Update static contract enumerations.**

Teach `check-model-config-contract.mjs` that `sound` is a valid model namespace/type and include the sound pricing/config relationships. Do not weaken strictness or add exceptions for ComfyUI.

- [ ] **Step 6: Verify the new exhaustive contract.**

Run:

```powershell
npm.cmd run typecheck
npm.cmd run check:capability-catalog
npm.cmd run check:pricing-catalog
npm.cmd run check:media-normalization
```

Expected: every command exits 0; any missing sound switch is fixed at its owning registry rather than with a cast or default branch.

- [ ] **Step 7: Commit the modality foundation.**

```powershell
git add src/lib/ai-registry src/lib/ai-providers/runtime-types.ts src/lib/ai-providers/shared/option-schema.ts src/lib/ai-exec src/lib/billing src/lib/profile/billing-transaction-display.ts src/lib/user-api/api-config-defaults.ts src/lib/ai-providers/comfyui/models.ts scripts/check-model-config-contract.mjs
git commit -m "feat(audio): add sound modality contract"
```

---

## Task 2: Persist and expose the authoritative `soundModel` configuration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260811120000_add_sound_model/migration.sql`
- Modify: `src/lib/config-service.ts`
- Modify: `src/lib/api-auth.ts`
- Modify: `src/lib/model-access/system-model-resolver.ts`
- Modify: `src/lib/platform-models/catalog.ts`
- Modify: `src/lib/platform-runtime/presets.ts`
- Modify: `src/lib/ai-registry/platform-models.ts`
- Modify: `src/lib/operations/domains/config/config-ops.ts`
- Modify: `src/lib/operations/domains/config/user-api-config-ops.ts`
- Modify: `src/lib/operations/domains/config/user-preference-ops.ts`
- Modify: `src/lib/operations/domains/project/project-crud-ops.ts`
- Modify: `src/lib/operations/domains/project/system-project-ops.ts`
- Modify: `src/lib/user-api/api-config-types.ts`
- Modify: `src/lib/user-api/api-config-defaults.ts`
- Modify: `src/lib/user-api/api-config-service.ts`
- Modify: `src/app/[locale]/profile/components/api-config/types.ts`
- Modify: `src/app/[locale]/profile/components/api-config/selectors.ts`
- Modify: `src/app/[locale]/profile/components/api-config/provider-card/types.ts`
- Modify: `src/app/[locale]/profile/components/api-config/provider-card/hooks/useProviderCardState.ts`
- Modify: `src/app/[locale]/profile/components/api-config-tab/DefaultModelCards.tsx`
- Modify: `src/app/[locale]/profile/components/api-config-tab/ApiConfigProviderList.tsx`
- Modify: `src/components/ui/config-modals/ConfigEditModal.tsx`
- Modify: `messages/zh/apiConfig.json`
- Modify: `messages/en/apiConfig.json`
- Modify: `messages/zh/configModal.json`
- Modify: `messages/en/configModal.json`
- Modify: `scripts/check-model-config-contract.mjs`

- [ ] **Step 1: Add nullable project and user-preference fields.**

Add `soundModel String?` beside `musicModel` on both Prisma owners. Create, but do not apply, this migration using the real mapped table/column names from `schema.prisma`:

```sql
ALTER TABLE `projects` ADD COLUMN `soundModel` VARCHAR(191) NULL;
ALTER TABLE `user_preferences` ADD COLUMN `soundModel` VARCHAR(191) NULL;
```

The current Prisma mappings are `projects` and `user_preferences`; keep those exact table names. Do not run `migrate deploy`, `migrate dev`, raw SQL, or any database write in this task.

- [ ] **Step 2: Make `soundModel` a first-class config field.**

Add it to project config reads/writes, user defaults, API config payloads, system project creation, platform preset fields, and strict parsing. Use `COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY` as the self-hosted platform default. Do not fall back from `soundModel` to `musicModel` or vice versa.

Extend `resolveSystemModelKey()` with purpose `'sound'` and have it read only `config.soundModel`; missing configuration must produce the existing required-model failure.

- [ ] **Step 3: Expose the setting through the existing config UI.**

Add a Sound Effect default-model selector/card beside Music. Provider filtering must use `modelType === 'sound'`. Add Chinese and English labels, descriptions, missing-model validation, save payload fields, and billing labels through locale dictionaries. Do not hard-code user-visible strings in TSX.

- [ ] **Step 4: Regenerate Prisma client only.**

```powershell
npx.cmd prisma generate
```

Expected: client generation succeeds without connecting to or altering MySQL.

- [ ] **Step 5: Verify config exhaustiveness and locale JSON.**

```powershell
npm.cmd run check:model-config-contract
npm.cmd run typecheck
@'
const fs = require('fs')
for (const file of [
  'messages/zh/apiConfig.json',
  'messages/en/apiConfig.json',
  'messages/zh/configModal.json',
  'messages/en/configModal.json',
]) JSON.parse(fs.readFileSync(file, 'utf8'))
console.log('locale-json-ok')
'@ | node
```

Expected: all commands exit 0 and the script prints `locale-json-ok`.

- [ ] **Step 6: Inspect migration state without applying it.**

```powershell
git diff -- prisma/schema.prisma prisma/migrations/20260811120000_add_sound_model/migration.sql
```

Expected: only the two nullable columns are introduced. Record that runtime E2E remains gated until Task 8 authorization.

- [ ] **Step 7: Commit config and migration source.**

```powershell
git add prisma src/lib/config-service.ts src/lib/api-auth.ts src/lib/model-access src/lib/platform-models src/lib/platform-runtime src/lib/ai-registry/platform-models.ts src/lib/operations/domains/config src/lib/operations/domains/project src/lib/user-api src/app/[locale]/profile/components/api-config src/app/[locale]/profile/components/api-config-tab src/components/ui/config-modals messages scripts/check-model-config-contract.mjs
git commit -m "feat(audio): add sound model configuration"
```

---

## Task 3: Upgrade `create_audio` to a strict music/sound request and billing plan

**Files:**

- Modify: `src/lib/workspace-resource/schema-registry.ts`
- Modify: `src/lib/workspace-resource/generation-request.ts`
- Modify: `src/lib/workspace-resource/generation-contract.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/task/definition.ts`
- Modify: `src/lib/billing/task-policy.ts`
- Modify: `src/lib/creative-skills/output-registry.ts` only if its declared schema version is explicit
- Modify: `tests/contracts/workspace-resource-operation-conformance.test.ts` only if production-registry conformance requires the new schema identity

- [ ] **Step 1: Add the canonical sound schema identity.**

Add:

```ts
SOUND_EFFECT_AUDIO: 'project.sound_effect_audio'
```

Include it in the audio generation schema registry and in `create_audio`'s declared alternative capabilities. Keep `BGM_AUDIO` unchanged.

- [ ] **Step 2: Replace implicit music input with a strict discriminated union.**

Define the shared type once:

```ts
export const audioGenerationKindSchema = z.enum(['music', 'sound'])
export type AudioGenerationKind = z.infer<typeof audioGenerationKindSchema>
```

Music keeps its existing fields and references but must declare `audioKind: 'music'` and `schemaId: BGM_AUDIO`. Sound uses only:

```ts
const soundGenerationItemSchema = z.object({
  ...commonItemShape,
  mediaType: z.literal('audio'),
  audioKind: z.literal('sound'),
  schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.SOUND_EFFECT_AUDIO),
  durationSeconds: z.number().int().min(1).max(30),
  negativePrompt: z.string().trim().min(1).max(100_000).optional(),
}).strict()
```

Because the object is strict and has no `references`, music-only fields, vocal settings, or mix fields, all such sound inputs must fail parsing. Upgrade the batch schema version from 2 to 3 and use decision `produce | no_audio`. Apply cue-overlap checks only to the filtered music items; do not invent overlap semantics for sound.

- [ ] **Step 3: Freeze the discriminator, final prompt, and selected model.**

Add `audioKind` to frozen audio resources and `soundModel` plus `negativePrompt` to the generation task payload. Enforce:

```ts
if (resource.mediaType === 'audio' && resource.audioKind === undefined) {
  ctx.addIssue({ code: 'custom', message: 'audioKind is required for audio resources' })
}
if (resource.mediaType !== 'audio' && resource.audioKind !== undefined) {
  ctx.addIssue({ code: 'custom', message: 'audioKind is forbidden for non-audio resources' })
}
```

The normal parser and retry-source parser must preserve the same frozen `audioKind`, `prompt`, `negativePrompt`, `durationSeconds`, schema, and model. Retry must never re-resolve a newer config value.

- [ ] **Step 4: Centralize kind-to-modality/model/schema mapping.**

In `generation-ops.ts`, add exhaustive helpers and replace every `mediaType === 'audio' ? 'music'` branch:

```ts
function modalityForAudioKind(kind: AudioGenerationKind): 'music' | 'sound' {
  switch (kind) {
    case 'music': return 'music'
    case 'sound': return 'sound'
  }
}

function modelPayloadForAudio(kind: AudioGenerationKind, modelKey: string) {
  switch (kind) {
    case 'music': return { musicModel: modelKey }
    case 'sound': return { soundModel: modelKey }
  }
}
```

Use those helpers for capability lookup, provider preflight, model purpose, billing API type, task payload, retry, and operation metadata. Resolve the model with purpose `music` or `sound` from the item discriminator only.

- [ ] **Step 5: Give the one audio task an explicit billing policy.**

Extend `TaskBillingPolicy` with `'audio'`, change only `WORKSPACE_RESOURCE_AUDIO` from `'music'` to `'audio'`, and add `buildAudioTaskInfo()`:

```ts
switch (payload.resource.audioKind) {
  case 'music': return buildMusicTaskInfo(taskType, payload)
  case 'sound': return buildSoundTaskInfo(taskType, payload)
}
```

`buildSoundTaskInfo` must require the frozen `soundModel`, duration, and `apiType: 'sound'`, then call `calcSound`. Missing/unknown fields return no plan so `requirePlannedTaskBillingInfo` fails before reservation; never silently charge as music.

- [ ] **Step 6: Run registry-derived contract verification.**

```powershell
npx.cmd vitest run tests/contracts/workspace-resource-operation-conformance.test.ts
npm.cmd run check:capability-catalog
npm.cmd run check:pricing-catalog
npm.cmd run typecheck
```

Expected: `create_audio` advertises both canonical audio schemas through the production registry, and every command exits 0. Do not add a new mock planning test.

- [ ] **Step 7: Commit the authoritative request/planning path.**

```powershell
git add src/lib/workspace-resource src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/task/definition.ts src/lib/billing/task-policy.ts src/lib/creative-skills/output-registry.ts tests/contracts/workspace-resource-operation-conformance.test.ts
git commit -m "feat(audio): plan sound resources through create audio"
```

---

## Task 4: Branch once in the existing audio handler and update planning guidance

**Files:**

- Modify: `src/lib/task/execution/handlers/workspace-resource-audio.ts`
- Modify: `src/lib/project-production-context.ts`
- Modify: `src/lib/creative-skills/skills/music-direction/SKILL.md`
- Modify: `src/lib/ai-prompts/templates/project-agent/system/project-agent-system.txt`
- Modify: `src/lib/ai-prompts/templates/project-agent/system/output-contracts.txt` if it contains the v2 audio schema
- Modify: `messages/zh/project.json`
- Modify: `messages/en/project.json`

- [ ] **Step 1: Keep one handler and make its branch exhaustive.**

Refactor `workspace-resource-audio.ts` into `executeMusicResource()` and `executeSoundResource()` private functions, selected by `payload.resource.audioKind`. Keep progress publication, provider route/provenance, download validation, MinIO upload, accepted-result construction, and terminal persistence outside or shared by both branches.

Sound must validate `payload.soundModel === payload.resource.modelKey`, reject any inputs, and call:

```ts
await generateSound(
  data.userId,
  payload.soundModel,
  payload.resource.prompt,
  {
    negativePrompt: payload.resource.negativePrompt,
    durationSeconds: payload.resource.durationSeconds,
    outputFormat: 'mp3',
  },
  { key: 'media:sound:primary' },
  {
    beforePoll: async () => await assertTaskActive(context, 'polling_external'),
    onPending: async ({ elapsedRatio, phase }) => {
      await reportTaskProgress(context, 30 + Math.floor(50 * elapsedRatio), {
        stage: 'polling_external',
        externalPhase: phase,
      })
    },
  },
)
```

Music retains `loadMusicVideoReference()` and its current invocation/artifact keys. Sound uses `media:sound:primary` and `sound:primary`. Both return through the existing audio artifact/materialization path and write no lifecycle fact directly.

- [ ] **Step 2: Make failures explicit at the handler boundary.**

Use stable errors for missing kind/model mismatch, forbidden sound inputs, invalid media type, and invalid MP3 result. A sound failure remains an attempt failure until the existing task lifecycle declares terminal failure; do not add a sound-specific status, timer, refetch, or retry loop.

- [ ] **Step 3: Expose sound capability in production context.**

Upgrade `project-production-context` schema version from 4 to 5 and add a `sound` section derived only from `config.soundModel` plus the registered model capability. Include configured/available, duration min/max, output formats, and prompt limit when declared. Do not infer availability from installed files or ComfyUI reachability.

- [ ] **Step 4: Teach the existing creative output how to emit sound items.**

Keep the single `audio_generation_batch` output and existing music-direction skill. Add strict guidance that:

- BGM uses `audioKind: music`, `project.bgm_audio`, and current music fields.
- Environmental/foley/action sound uses `audioKind: sound`, `project.sound_effect_audio`, a final bilingual-capable prompt, optional final negative prompt, 1–30 seconds, and no references.
- `no_audio` is used only when neither music nor sound is needed.
- The agent must not request speech/TTS, automatic mix, video embedding, or provider-specific node parameters.

Add matching Chinese/English user-visible progress and capability copy through locale JSON.

- [ ] **Step 5: Verify the single handler/entry/writer invariant.**

```powershell
rg -n "create_sound|WORKSPACE_RESOURCE_SOUND|sound-resource-audio|soundEffectTask" src
rg -n "WORKSPACE_RESOURCE_AUDIO|workspaceResourceAudio|materializeWorkspaceResourceInTransaction" src/lib/task src/lib/workspace-resource
npm.cmd run typecheck
```

Expected: the first command has no results; the second shows the existing audio task/handler/materializer path; typecheck exits 0.

- [ ] **Step 6: Commit handler and creative contract changes.**

```powershell
git add src/lib/task/execution/handlers/workspace-resource-audio.ts src/lib/project-production-context.ts src/lib/creative-skills/skills/music-direction/SKILL.md src/lib/ai-prompts/templates/project-agent/system messages
git commit -m "feat(audio): execute sound in shared audio lifecycle"
```

---

## Task 5: Extract shared ComfyUI transport without changing H3 behavior

**Files:**

- Create: `src/lib/ai-providers/comfyui/client.ts`
- Modify: `src/lib/ai-providers/comfyui/h3.ts`
- Modify: `src/lib/ai-providers/comfyui/async-task.ts`
- Verify unchanged: `tests/contracts/comfyui-h3-profile-conformance.test.ts`
- Verify unchanged: `tests/integration/provider/comfyui-h3-submission.contract.test.ts`

- [ ] **Step 1: Move protocol primitives into one shared client.**

Extract, preserving behavior and error identity:

```ts
export class ComfyUiHttpError extends Error { /* status and parsed body */ }
export function asRecord(value: unknown): Record<string, unknown> | null
export function readString(value: unknown): string | null
export async function requestComfyUiJson(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<unknown>
export async function requireComfyUiNode(baseUrl: string, className: string): Promise<void>
export async function downloadComfyUiOutput(input: {
  baseUrl: string
  output: { filename: string; subfolder: string; type: string }
  expectedContentTypes: readonly string[]
  maxBytes: number
  label: string
}): Promise<{ buffer: Buffer; contentType: string }>
export async function cancelComfyUiJob(baseUrl: string, promptId: string): Promise<void>
```

Keep URL construction, HTTP error parsing, auth-free local behavior, size limits, content-type validation, queue/history semantics, and cancellation semantics identical to H3.

- [ ] **Step 2: Refactor H3 to consume the shared client.**

Delete the duplicate private helpers from `h3.ts`. Do not change H3 workflow assets, prompt mutation, external ID format, node checks, output selection, retry classification, or public errors.

- [ ] **Step 3: Generalize async identity parsing only as far as needed.**

Allow exact identities `COMFYUI:VIDEO:<promptId>` and `COMFYUI:SOUND:<promptId>`. Poll/cancel dispatch must switch exhaustively on parsed kind. Unknown kind, extra segments, or empty prompt id must fail; do not accept legacy aliases.

- [ ] **Step 4: Run existing H3 protocol and profile oracles.**

```powershell
npx.cmd vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts
npm.cmd run typecheck
```

Expected: all existing H3 cases pass unchanged. If a test fails, restore exact behavior in the shared client before continuing.

- [ ] **Step 5: Commit the transport refactor separately.**

```powershell
git add src/lib/ai-providers/comfyui/client.ts src/lib/ai-providers/comfyui/h3.ts src/lib/ai-providers/comfyui/async-task.ts
git commit -m "refactor(comfyui): share media transport client"
```

---

## Task 6: Implement the repository-owned MOSS workflow profile and provider adapter

**Files:**

- Create: `src/lib/ai-providers/comfyui/workflows/moss-soundeffect-v2/source/sound-effect.ui.json`
- Create: `src/lib/ai-providers/comfyui/workflows/moss-soundeffect-v2/runtime/sound-effect.api.json`
- Create: `src/lib/ai-providers/comfyui/moss-soundeffect-profile.ts`
- Create: `src/lib/ai-providers/comfyui/moss-soundeffect.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `src/lib/ai-providers/comfyui/async-task.ts`
- Modify: `src/lib/ai-providers/comfyui/config.ts`
- Modify: `src/lib/ai-providers/index.ts`
- Create: `tests/contracts/comfyui-moss-soundeffect-profile-conformance.test.ts`
- Create: `tests/integration/provider/comfyui-moss-soundeffect-submission.contract.test.ts`

- [ ] **Step 1: Check in the exact audited source and minimal API graph.**

Copy the verified source workflow content from `D:\workspace\comfui\workflows\音效生成.json` into the repository source asset without semantic edits. Build a minimal API graph containing exactly:

- node `29`: `MOSS_SoundEffectV2Loader`, model `OpenMOSS-Team/MOSS-SoundEffect-v2.0`, `auto_download: false`, `local_files_only: true`, `disable_torch_compile: true`, verified dtype/device defaults;
- node `30`: `MOSS_SoundEffectV2Generate`, prompt/negative/duration/seed/steps/CFG/sigma inputs, connected to node 29;
- node `28`: `SaveAudioMP3`, connected to node 30, filename prefix token, quality `V0`.

Remove the canvas-only prompt node and preview-only behavior. Runtime mutation may touch only declared prompt, negative prompt, duration, seed, and filename-prefix slots.

- [ ] **Step 2: Define one immutable profile.**

Export a profile with `modelId: 'moss-soundeffect-v2'`, loader/generator/output class names, node IDs, mutable input slots, required model option, duration `[1, 30]`, output format `mp3`, and output node `28`. Validate the runtime JSON at module load with explicit object/string/number guards; never use `any`.

- [ ] **Step 3: Write failing production-derived conformance tests first.**

The profile test must derive its oracle from the production registry/profile and assert:

- registry modality/capability agrees with profile duration and MP3 output;
- every declared class and mutable slot exists in the runtime graph;
- loader model is exact, `auto_download` is false, `local_files_only` is true, and `disable_torch_compile` is true;
- generator connects to loader and output connects to generator;
- no undeclared node/input is mutated.

Run it before implementation completion and confirm it fails for the missing profile, then make it pass.

- [ ] **Step 4: Implement verbatim graph mutation and local preflight.**

`describe()` returns the registered sound capability. `execute()` validates duration/output, clones the graph, assigns `prompt` and `negativePrompt` exactly as received, chooses/provides the frozen seed, assigns a collision-safe prefix, checks `/object_info` for all three classes and the exact loader model option, then POSTs `/prompt`.

Local deterministic failures happen before POST. Do not probe disk paths, start ComfyUI, download a model, or change devices.

- [ ] **Step 5: Implement uncertain-submission recovery and output materialization.**

Use the H3 reference policy:

- HTTP 4xx from `/prompt`: rejected; do not probe or retry as accepted.
- Transport/5xx uncertainty after a prompt id is known: query queue/history for the same prompt id; return accepted only when that exact job exists, otherwise return the shared unknown-submission error.
- Accepted identity: exactly `COMFYUI:SOUND:<promptId>`.
- Poll: read the exact prompt history; running/pending/failed/completed map through the shared async task contract.
- Completed: read only node `28`, require one MP3 output reference, download through `/view`, require `audio/mpeg` or `audio/mp3`, enforce byte limit, return the shared generated-audio result.
- Cancel: cancel only the parsed prompt id through the shared client.

- [ ] **Step 6: Register the sound adapter.**

Add `sound.describe` and `sound.execute` to the existing ComfyUI adapter and register SOUND polling/cancellation in the same provider async adapter. Update unsupported-modality diagnostics to include sound. Do not add another provider name or adapter instance.

- [ ] **Step 7: Add a real HTTP scenario-server protocol suite.**

Using a local HTTP server rather than mocked provider functions, cover:

- deterministic invalid duration/output and missing class/model fail before `/prompt`;
- prompt and negative prompt arrive byte-for-byte unchanged in posted JSON;
- HTTP 400 is rejected without queue/history recovery;
- HTTP 503/connection loss with exact job visible recovers accepted;
- HTTP 503/connection loss without exact job returns unknown submission;
- pending/running/failed/completed history states;
- completed history with wrong/multiple/missing node-28 output fails;
- `/view` wrong content type or oversized body fails;
- valid MP3 returns bytes and `COMFYUI:SOUND:<promptId>`.

These cases use the ComfyUI protocol response as the independent oracle; do not assert internal helper call counts.

- [ ] **Step 8: Run provider conformance.**

```powershell
npx.cmd vitest run tests/contracts/comfyui-moss-soundeffect-profile-conformance.test.ts tests/integration/provider/comfyui-moss-soundeffect-submission.contract.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts
npm.cmd run typecheck
```

Expected: all MOSS and unchanged H3 tests pass.

- [ ] **Step 9: Commit the provider implementation.**

```powershell
git add src/lib/ai-providers/comfyui tests/contracts/comfyui-moss-soundeffect-profile-conformance.test.ts tests/integration/provider/comfyui-moss-soundeffect-submission.contract.test.ts src/lib/ai-providers/index.ts
git commit -m "feat(comfyui): integrate MOSS sound effects"
```

---

## Task 7: Record the new audio invariant and verify the live adapter boundary

**Files:**

- Modify: `docs/architecture/modules/audio-production.md`
- Create then delete before commit: `.codex_tmp/moss-soundeffect-live-smoke.ts`

- [ ] **Step 1: Add only the approved durable invariant.**

Add one invariant to Audio Production, with the next available ID:

> Every generated audio resource declares a frozen `audioKind`; music and sound resolve separate configured model purposes and billing modalities, while sharing the single `create_audio` execution and terminal-write chain. No consumer may infer audio kind from prompt, schema text, model identity, or output content.

Add one concise pit entry explaining that the former standalone environment-sound route/queue created a second lifecycle and did not prove a live provider boundary. Do not copy file lists, node IDs, duration values, current instances, verification commands, or the implementation plan into architecture docs.

- [ ] **Step 2: Verify live ComfyUI prerequisites read-only.**

Against `http://127.0.0.1:8878`, check `/object_info` and assert the three required classes plus exact loader model option. Check `/queue` is reachable. Do not start/restart ComfyUI or download models.

- [ ] **Step 3: Exercise the production adapter, not a handwritten graph POST.**

Create the temporary ignored TypeScript smoke script with `apply_patch`. It must import the registered ComfyUI adapter/engine, select `comfyui::moss-soundeffect-v2`, submit a unique Chinese environmental prompt, wait through the production async adapter, and write only its returned MP3 bytes to `.codex_tmp` for inspection. Use 5 seconds and a unique invocation/task identity. It must print:

- selected model and route;
- accepted `COMFYUI:SOUND:<promptId>`;
- terminal status;
- returned MIME type, byte count, and output duration probed by `ffprobe` or bundled ffmpeg;
- evidence that the posted prompt/negative prompt were not rewritten, when available from the local scenario/log capture.

Do not call `/prompt` directly in the smoke script.

- [ ] **Step 4: Inspect the audio evidence.**

Require MP3, 48 kHz, non-zero signal, duration within normal encoder tolerance of 5 seconds, and a valid HTTP/provider provenance. Retain the generated audio only in ignored `.codex_tmp`; do not commit binary output.

- [ ] **Step 5: Delete the temporary script and output with exact targets.**

Resolve and print the absolute `.codex_tmp` files, verify they are under this worktree, then remove only those smoke files. Do not recursively delete `.codex_tmp` or any workspace directory.

- [ ] **Step 6: Verify architecture routing and commit the invariant.**

```powershell
npm.cmd run architecture:impact -- docs/architecture/modules/audio-production.md src/lib/task/execution/handlers/workspace-resource-audio.ts src/lib/ai-providers/comfyui
git diff --check
git add docs/architecture/modules/audio-production.md
git commit -m "docs(audio): define sound generation invariant"
```

Expected: impact maps the changes to Audio Production, Workspace Resource, Async Task Lifecycle, and Provider Gateway as appropriate; `git diff --check` exits 0.

---

## Task 8: Run the gated database/Temporal/MinIO E2E and completion audit

**Files:**

- No production file changes expected
- Create then delete before completion: `.codex_tmp/moss-soundeffect-create-audio-e2e.ts`

- [ ] **Step 1: Stop and request explicit migration authorization.**

Report the exact database host/name resolved from the local ignored environment without printing credentials. Ask permission to apply `20260811120000_add_sound_model` to that named local database. Do not continue to Step 2 without explicit approval.

If approval is denied or unavailable, skip Steps 2–5, leave the migration unapplied, and classify completion as implementation-complete with an explicit real-`create_audio` E2E blind spot. Live adapter evidence from Task 7 does not replace this gate.

- [ ] **Step 2: Apply only the approved migration and verify columns.**

After approval, run the repository's normal local migration command against the named target. Inspect Prisma migration status and read schema metadata to confirm only `Project.soundModel` and `UserPreference.soundModel` were added. Do not modify or clean user records.

- [ ] **Step 3: Configure a test-scoped sound model through the authoritative operation.**

Use an existing disposable/test project and user approved for this check. Set `soundModel` via the existing config operation/API service, never with raw SQL. Read it back through the same authoritative config view and require the exact MOSS model key.

- [ ] **Step 4: Submit through the real `create_audio` operation and Temporal.**

Use the production operation registry and durable dispatcher, not the handler directly. The temporary script must call the same execution path used by `POST /api/projects/[projectId]/operations/create_audio/execute` with an `audio_generation_batch` v3 containing one `audioKind: 'sound'` item, `project.sound_effect_audio`, a final Chinese prompt, no references, and 5 seconds.

Capture the resulting operation receipt/task id, then observe authoritative task/resource views until terminal. Do not add a test-only queue, invoke the activity directly, or poll ComfyUI independently.

- [ ] **Step 5: Verify end-to-end facts from authoritative stores.**

Require all of the following:

- one workspace resource with schema `project.sound_effect_audio` and frozen `audioKind: sound`;
- one `WORKSPACE_RESOURCE_AUDIO` task, not a new sound task type;
- frozen `soundModel` equals the configured MOSS key and retry parsing preserves it;
- provider provenance/external id is `COMFYUI:SOUND:<promptId>`;
- one completed terminal lifecycle, one artifact/materialization path, and no competing sound status;
- MinIO object is an MP3 downloadable through the normal workspace resource view;
- billing uses `apiType: sound` and the configured zero-cost local price;
- no BGM record, video mix, TTS record, or reference relation is created.

Inspect MySQL/MinIO read-only after submission; do not delete existing data. Remove only the specifically created disposable resource/project if the user separately authorizes cleanup.

- [ ] **Step 6: Run the complete verification suite.**

```powershell
npm.cmd run typecheck
npm.cmd run check:capability-catalog
npm.cmd run check:pricing-catalog
npm.cmd run check:model-config-contract
npm.cmd run check:media-normalization
npx.cmd vitest run tests/contracts/workspace-resource-operation-conformance.test.ts tests/contracts/comfyui-moss-soundeffect-profile-conformance.test.ts tests/integration/provider/comfyui-moss-soundeffect-submission.contract.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts
git diff --check
git status --short
```

Expected: all commands exit 0. `git status` contains no temporary scripts/audio, no untracked migration artifacts, and no unrelated staged files.

- [ ] **Step 7: Audit entry/writer counts and reference alignment.**

Deliver this table with evidence:

| Concern | H3 reference | MOSS sound result |
|---|---|---|
| Identity | `COMFYUI:VIDEO:<promptId>` | `COMFYUI:SOUND:<promptId>` |
| Capability registry | video profile/model | sound profile/model |
| Submission uncertainty | exact job probe | same policy |
| Poll/cancel | shared async adapter | same adapter, SOUND branch |
| Output selection | declared video node | node 28 MP3 only |
| Task/lifecycle | workspace media task | existing audio task |
| Terminal writer | workspace resource materializer | same writer |
| Config owner | project/user video model | project/user sound model |
| Pricing | video API type | sound API type |
| Recovery/retry | frozen model/prompt | frozen kind/model/prompts |
| UI/i18n | registry-derived selector | sound selector/locales |

Also report counts before/after: public audio entries `1 -> 1`, audio task types `1 -> 1`, audio terminal writers `1 -> 1`, audio-kind interpreters `implicit/multiple -> one frozen discriminator plus exhaustive branches`, provider fallback paths `0 -> 0`.

- [ ] **Step 8: Request code review and finish the branch.**

Invoke `superpowers:requesting-code-review`, address findings through `superpowers:receiving-code-review`, rerun affected verification, then use `superpowers:finishing-a-development-branch`. Do not merge, push, or apply cleanup without the user's requested delivery action.

## Completion Classification

- **Implementation complete:** code/config/migration source, contract checks, protocol tests, H3 regression, and live production-adapter smoke pass; migration or real task E2E may still be gated and must be named as a blind spot.
- **Stage complete:** the approved local migration is applied, the real `create_audio -> Temporal -> ComfyUI -> MinIO/MySQL -> workspace view` path passes, the architecture invariant is recorded, and no temporary/competing path remains.
- Do not claim “architecture complete,” “彻底,” or “不会复发” unless the entry/writer audit, live task E2E, migration state, retry/recovery evidence, and code review all have no material blind spot.
