# ComfyUI Audio Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Integrate the two user-verified Stable Audio 3 ComfyUI workflows into Wao through one explicit `create_audio` entry that supports only instrumental music and environment sound.

**Architecture:** Keep `create_audio` as the sole public action and add a discriminated `audioKind` (`music` or `environment`) to the frozen request/task contract. Register two exact ComfyUI workflow profiles in the existing provider/capability/async registries; the provider submits a pre-audited API graph, polls the exact prompt id, downloads only the declared SaveAudioMP3 result, and returns through the existing artifact materializer. Persist a separate `soundModel` default without executing its migration unless separately authorized.

**Tech Stack:** TypeScript, Zod, Prisma schema/migrations, existing Provider Gateway and async Task lifecycle, ComfyUI `/prompt`/`/queue`/`/history`/`/view`, JSON workflow assets, npm scripts.

---

### Task 1: Extend the audio domain contract without adding a second entry point

**Files:**
- Modify: `src/lib/workspace-resource/generation-request.ts`
- Modify: `src/lib/workspace-resource/generation-contract.ts`
- Modify: `src/lib/workspace-resource/schema-registry.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/task/execution/handlers/workspace-resource-audio.ts`
- Modify: `src/lib/ai-exec/engine.ts`
- Modify: `src/lib/ai-registry/types.ts`
- Modify: `src/lib/ai-registry/model-contracts.ts`
- Modify: `docs/architecture/modules/audio-production.md`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260809160000_add_sound_model_defaults/migration.sql`

- [ ] **Step 1: Add the discriminant and environment schema.**

Change the shared item from an implicit music object to a strict union with this shape:

```ts
const musicGenerationItemSchema = z.object({
  ...commonItemShape,
  mediaType: z.literal('audio'),
  audioKind: z.literal('music'),
  schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO),
  references: z.array(generationReferenceSchema.extend({
    channel: z.enum(['context', 'video']),
  }).strict()).max(16).optional(),
  durationSeconds: z.number().int().min(1).max(600),
  vocalMode: z.literal('instrumental'),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  startSeconds: z.number().finite().nonnegative().optional(),
  purpose: z.string().trim().min(1).max(4_000).optional(),
  musicalDirection: z.string().trim().min(1).max(8_000).optional(),
  dialogueSafety: z.string().trim().min(1).max(2_000).nullable().optional(),
}).strict()

const environmentGenerationItemSchema = z.object({
  ...commonItemShape,
  mediaType: z.literal('audio'),
  audioKind: z.literal('environment'),
  schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.ENVIRONMENT_AUDIO),
  references: z.array(generationReferenceSchema.extend({
    channel: z.literal('context'),
  }).strict()).max(16).optional(),
  durationSeconds: z.number().int().min(1).max(600),
  purpose: z.string().trim().min(1).max(4_000).optional(),
}).strict()

export const audioGenerationItemSchema = z.discriminatedUnion('audioKind', [
  musicGenerationItemSchema,
  environmentGenerationItemSchema,
])
```

Keep the output decision as `produce | no_music` for compatibility with the existing creative output, but let both item variants pass through the same schema and reject environment-only music fields at parse time.

- [ ] **Step 2: Freeze `audioKind` and `soundModel` in task payloads.**

Add `audioKind: z.enum(['music', 'environment'])` to the frozen resource and add `soundModel` beside `musicModel`. Preserve both fields in `parseWorkspaceResourceGenerationTaskPayload` and its retry-source parser. Update the planning code so `modelPayload('audio', modelKey, audioKind)` returns `{ musicModel: modelKey }` for music and `{ soundModel: modelKey }` for environment.

The handler contract must reject a mismatch with an explicit error:

```ts
if (payload.resource.audioKind === 'music' && payload.musicModel !== payload.resource.modelKey) {
  throw new Error(`WORKSPACE_RESOURCE_MUSIC_TASK_CONTRACT_INVALID:${data.taskId}`)
}
if (payload.resource.audioKind === 'environment' && payload.soundModel !== payload.resource.modelKey) {
  throw new Error(`WORKSPACE_RESOURCE_ENVIRONMENT_TASK_CONTRACT_INVALID:${data.taskId}`)
}
```

- [ ] **Step 3: Add `project.environment_audio` and persistence defaults.**

Add `ENVIRONMENT_AUDIO: 'project.environment_audio'` to the resource schema registry and include it in the audio generation schema ids. Add nullable `soundModel` to `Project` and `UserPreference`, then create the migration file:

```sql
ALTER TABLE `projects` ADD COLUMN `soundModel` VARCHAR(191) NULL;
ALTER TABLE `user_preferences` ADD COLUMN `soundModel` VARCHAR(191) NULL;
```

Do not run `prisma migrate deploy`, `prisma db push`, or any data migration. The migration file is part of the implementation only.

- [ ] **Step 4: Route execution by explicit kind.**

Extend `AiModality` with `'sound'`, include it in the capability model type mapping, and add `generateSound` as a thin modality-specific wrapper around the existing media execution function. Update the audio handler to call `generateMusic` for music and `generateSound` for environment; do not add a second task handler or route.

- [ ] **Step 5: Update the architecture invariant and run contract checks.**

Add one invariant to `docs/architecture/modules/audio-production.md`: the audio kind is explicit and is never inferred from prompt, filename, model name, or output bytes. Run:

```powershell
npm.cmd run typecheck
npm.cmd run check:capability-catalog
npm.cmd run check:model-config-contract -- --strict
```

Expected result: the command reaches the new Zod/task contracts and either passes or reports only missing provider registrations to be completed in Task 2.

### Task 2: Register exact ComfyUI Stable Audio profiles and copy local workflow assets

**Files:**
- Create: `src/lib/ai-providers/comfyui/workflows/stable-audio-3/source/environment.ui.json`
- Create: `src/lib/ai-providers/comfyui/workflows/stable-audio-3/source/pure-music.ui.json`
- Create: `src/lib/ai-providers/comfyui/workflows/stable-audio-3/runtime/environment.api.json`
- Create: `src/lib/ai-providers/comfyui/workflows/stable-audio-3/runtime/pure-music.api.json`
- Create: `src/lib/ai-providers/comfyui/profiles.ts`
- Create: `src/lib/ai-providers/comfyui/client.ts`
- Create: `src/lib/ai-providers/comfyui/audio.ts`
- Create: `src/lib/ai-providers/comfyui/adapter.ts`
- Create: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/ai-providers/builtin-catalog.ts`
- Modify: `src/lib/ai-registry/capabilities-catalog.ts` registration call site
- Modify: `src/lib/ai-registry/pricing-catalog.ts`
- Modify: `src/lib/ai-registry/platform-models.ts`

- [ ] **Step 1: Copy the user workflows into the project-owned source directory.**

Copy, without editing, from:

```powershell
Copy-Item -LiteralPath 'D:\workspace\comfui\workflows\stable-audio-3-medium.json' -Destination 'src\lib\ai-providers\comfyui\workflows\stable-audio-3\source\environment.ui.json'
Copy-Item -LiteralPath 'D:\workspace\comfui\workflows\stable+audio3+pure+music.json' -Destination 'src\lib\ai-providers\comfyui\workflows\stable-audio-3\source\pure-music.ui.json'
```

Parse both JSON files and assert the known node ids/classes before producing runtime graphs. The source files remain immutable project copies; never write back to `D:\workspace\comfui`.

- [ ] **Step 2: Commit hand-audited runtime API graphs.**

Create runtime JSON graphs containing only the generation chain and the declared output node. Pure Music keeps checkpoint `audio\\stable_audio_3_medium_base.safetensors`, Stable Audio CLIP `audio\\t5gemma_b_b_ul2.safetensors`, duration node 59, KSampler node 60 (`50`, CFG `7`, `euler`, `simple`), positive node 62, empty negative node 57, VAE node 58, and SaveAudioMP3 node 19. Environment keeps checkpoint `audio\\stable_audio_3_medium.safetensors`, CLIP node 100, duration node 83, KSampler node 84 (`8`, CFG `1`, `lcm`, `simple`), positive node 86, negative node 81, VAE node 82, and SaveAudioMP3 node 78.

Remove Pure Music Qwen/TextGenerate/templates/Switch/StringReplace/Preview/Markdown nodes from the runtime graph. The adapter writes the final prompt directly to node 62 or 86 and duration/seed directly to the declared numeric fields.

- [ ] **Step 3: Add profile contracts and strict graph validation.**

Define a profile type with `modelKey`, `modality`, `audioKind`, `graphPath`, `checkpoint`, `promptNodeId`, `durationNodeId`, `samplerNodeId`, `outputNodeId`, fixed sampler parameters, and a `validateGraph(graph: unknown)` function. Resolve only these model keys:

```ts
comfyui::stable-audio-3-medium-pure-music
comfyui::stable-audio-3-medium-environment
```

Unknown model keys, missing nodes, mismatched `class_type`, changed checkpoint, changed output node, or changed fixed negative prompt must throw before POST `/prompt`.

- [ ] **Step 4: Add the ComfyUI client and audio adapter.**

Use `parseComfyUiConfig()` for the base URL, POST `{ prompt: graph }` to `/prompt`, and return the `prompt_id` without re-submitting on retry. Polling and result parsing are implemented in the async registration in Task 3. The adapter must accept only the declared `SaveAudioMP3` result shape:

```ts
type ComfyAudioOutput = { filename: string; subfolder: string; type: 'output' | 'temp' }
```

Reject path traversal, missing filename/subfolder/type, non-audio MIME, and payloads over 100 MiB. Download `/view?filename=...&subfolder=...&type=...` through the ComfyUI client and return bounded audio bytes to the shared result projector.

- [ ] **Step 5: Register capabilities, models, pricing, and defaults.**

Register music profile as `music` with `vocalModeOptions: ['instrumental']` and sound profile as `sound` with `audioKindOptions: ['environment']`. Add both to the builtin provider catalog, zero-credit self-hosted pricing, and platform defaults. Keep existing explicit project `musicModel` values unchanged; only the inherited platform default changes to Pure Music. Set inherited `soundModel` to Environment.

### Task 3: Integrate ComfyUI into the existing async provider lifecycle

**Files:**
- Modify: `src/lib/ai-providers/async-task-types.ts`
- Create: `src/lib/ai-providers/comfyui/async-task.ts`
- Modify: `src/lib/ai-providers/index.ts`
- Modify: `src/lib/ai-exec/async-wait.ts`
- Modify: `src/lib/ai-exec/engine.ts`
- Modify: `src/lib/task/execution/provider-media.ts`

- [ ] **Step 1: Add the provider code and strict external id.**

Add `COMFYUI` to the async provider code union and parse IDs matching:

```text
COMFYUI:MUSIC:<profile-token>:<prompt-id>
COMFYUI:SOUND:<profile-token>:<prompt-id>
```

The parser returns the profile and prompt id; malformed or mismatched ids throw. Register the provider in `src/lib/ai-providers/index.ts`.

- [ ] **Step 2: Implement submission and polling.**

Use `/queue` to classify queued/running and `/history/{promptId}` as the only completion/failure authority. A missing terminal field or malformed history returns a typed failure, never success. Emit `ProviderAsyncTaskStatus` phases through the existing wait callbacks.

- [ ] **Step 3: Implement cancellation and resume semantics.**

For queued prompts, call the exact queue-delete operation for that prompt id. For running prompts, do not call global `/interrupt`; return a typed best-effort cancellation result and let the local Task terminal state ignore any late result. Polling the same external id after process restart must not POST `/prompt` again.

- [ ] **Step 4: Make `sound` use existing media execution machinery.**

Extend the media modality union and the async wait branch to include `sound`, then expose:

```ts
export async function generateSound(
  userId: string,
  modelKey: string,
  prompt: string,
  options?: AiSoundExecutionOptions,
  invocation?: TaskProviderInvocation,
  wait?: AsyncProviderWaitCallbacks,
): Promise<GenerateResult>
```

Do not duplicate task authorization, invocation persistence, polling, or artifact materialization.

- [ ] **Step 5: Verify provider contract locally.**

Run `npm.cmd run typecheck`, `npm.cmd run check:capability-catalog`, `npm.cmd run check:pricing-catalog`, and the relevant provider conformance suite. Expected result: both exact model ids resolve to one registered adapter and one async provider, while unsupported model ids fail before network submission.

### Task 4: Complete configuration, handler, and user-visible contract wiring

**Files:**
- Modify: `src/lib/config-service.ts`
- Modify: `src/lib/operations/domains/config/config-ops.ts`
- Modify: `src/lib/operations/domains/config/user-preference-ops.ts`
- Modify: `src/lib/operations/domains/config/user-api-config-ops.ts`
- Modify: `src/lib/user-api/api-config-types.ts`
- Modify: `src/lib/user-api/api-config-service.ts`
- Modify: `src/lib/user-api/api-config-defaults.ts`
- Modify: `src/lib/task/execution/handlers/workspace-resource-audio.ts`
- Modify: `src/lib/ai-providers/comfyui/config.ts`
- Modify: `src/lib/creative-skills/runtime-skills.ts`
- Create: `src/lib/creative-skills/skills/environment-audio-direction/SKILL.md`
- Modify: locale files containing model/config/error messages

- [ ] **Step 1: Add `soundModel` to every configuration owner.**

Follow the existing `musicModel` path in config service, project config operations, user preference operations, API config types, API config service, defaults, and profile model cards. `soundModel` must be an explicit model key and must never be inferred from `musicModel`.

- [ ] **Step 2: Update the audio task handler.**

For `audioKind: 'music'`, retain video-reference loading and the existing `project.bgm_audio` artifact path. For `audioKind: 'environment'`, reject video/audio/image references, call `generateSound`, persist `project.environment_audio`, and set artifact metadata to `soundModel`/`sound`. Both branches use the same `reportTaskProgress`, `assertTaskActive`, `loadGeneratedAudio`, upload, and media-object helpers.

- [ ] **Step 3: Add environment prompt skill and instruction wiring.**

Create the environment skill with explicit exclusion of music, melody, speech, dialogue, vocals, narration, lyrics, and singing. Update runtime skill registration and localized descriptions so the agent produces a complete provider-ready environment prompt. Keep the existing music skill instrumental-only.

- [ ] **Step 4: Add configuration validation and localized errors.**

Add errors for missing ComfyUI URL, unsupported audio kind/model, graph drift, submission outcome unknown, malformed history, missing output, invalid MIME, and oversize result. Add both Chinese and English messages; do not hard-code user-visible Chinese or English inside route/adapter logic.

### Task 5: Validate the real trigger path and finish delivery

**Files:**
- Modify: `docs/architecture/modules/audio-production.md`
- Modify: `docs/architecture/modules/provider-gateway.md` only if the new `sound` modality adds an invariant
- Modify: applicable registry/conformance checks

- [ ] **Step 1: Validate local ComfyUI prerequisites.**

Call the configured ComfyUI `/object_info` endpoint and assert the required node classes, checkpoint names, and CLIP names for both profiles. Parse both source UI JSON and both runtime API JSON files.

- [ ] **Step 2: Run the closest static checks.**

```powershell
npm.cmd run typecheck
npm.cmd run check:capability-catalog
npm.cmd run check:pricing-catalog
npm.cmd run check:model-config-contract -- --strict
npm.cmd run check:media-normalization
```

- [ ] **Step 3: Run real provider smoke requests.**

From the project adapter, submit one short pure-instrumental music prompt and one short environment prompt. Verify each path reaches `/prompt`, `/queue`, `/history`, `/view`, returns MP3 bytes, and records the exact ComfyUI model key. Do not execute a database migration as part of this step.

- [ ] **Step 4: Run the real `create_audio` trigger path.**

Submit one `audioKind: 'music'` and one `audioKind: 'environment'` operation through the existing project operation entry point. Verify the Task payload, provider route, terminal artifact, resource schema, duration, and terminal materializer. If `soundModel` migration has not been separately authorized and applied, mark the Project/UserPreference-backed end-to-end check as blocked/unverified rather than applying it implicitly.

- [ ] **Step 5: Review diff and commit only owned changes.**

Run `git status --short`, `git diff --check`, and `git diff --cached --stat`. Stage only the audio module files and project-owned workflow assets; exclude `middleware.ts`, `package-lock.json`, and `src/app/page.tsx`. Create focused commits for domain contract, provider/workflow, and configuration/verification, then push only after all verification is reported.

---

## Self-review checklist

- Every design section maps to at least one task: explicit kind, separate schema, exact profiles, source/runtime asset isolation, async lifecycle, cancellation, defaults, pricing, i18n, architecture invariant, and real trigger verification.
- No task introduces a second public audio route, task state machine, writer, prompt router, or Provider fallback.
- The only database mutation is a migration file; execution remains an explicit authorization gate.
- The plan preserves existing project/user dirty files and names the exact verification commands.
