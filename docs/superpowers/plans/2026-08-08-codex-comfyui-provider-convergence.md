# Codex and ComfyUI Provider Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex the only text/image provider and ComfyUI the only video/audio/voice provider, with the ComfyUI address read from `COMFYUI_BASE_URL`.

**Architecture:** Keep the current `ai-registry -> ai-providers -> ai-exec` execution path. Port the proven Codex image client and the ComfyUI workflow/client implementation from `main` into provider adapters that return the current `GenerateResult` contract. Remove old provider registration and routing from the current catalog, while retaining historical database credentials without reading or displaying them.

**Tech Stack:** Next.js, TypeScript, AI SDK v6, Prisma, Vitest, ComfyUI HTTP API, Codex CLI/runtime.

## Global Constraints

- The only user-visible providers are `codex` and `comfyui`.
- Codex owns `llm` and `image`; ComfyUI owns `video`, `music`, and `voice`.
- ComfyUI service location is read server-side from `COMFYUI_BASE_URL`; no hard-coded host or port is allowed.
- ComfyUI does not require a user API key; historical API keys are not physically deleted by this change.
- Do not merge `main`'s legacy Generator/API Config architecture into the current branch.
- All provider executions must return the current `GenerateResult` or current LLM result contracts.
- Every behavior change gets a focused unit/contract test before the implementation is considered complete.

---

### Task 1: Establish provider and environment contracts

**Files:**
- Create: `src/lib/ai-providers/comfyui/config.ts`
- Create: `tests/unit/ai-providers/comfyui/config.test.ts`
- Modify: `.env.example`
- Modify: `.env.cloud.example`
- Modify: `src/lib/deployment/platform-provider-env.json`
- Modify: `src/lib/user-api/runtime-config.ts`
- Modify: `src/lib/ai-registry/runtime-selection.ts`

**Interfaces:**
- Produces `readComfyUiBaseUrl(environment?: NodeJS.ProcessEnv): string`.
- Produces `ComfyUiConfigError` with stable codes for missing and invalid URLs.
- `getProviderConfig(userId, 'comfyui')` returns the validated environment URL and an empty API key without reading a stored user key.

- [ ] **Step 1: Write failing config tests**

```ts
it('reads and trims COMFYUI_BASE_URL without adding a provider-specific default', () => {
  expect(readComfyUiBaseUrl({ COMFYUI_BASE_URL: ' http://127.0.0.1:8188/ ' })).toBe('http://127.0.0.1:8188')
})

it('rejects a missing or credential-bearing URL', () => {
  expect(() => readComfyUiBaseUrl({})).toThrow('COMFYUI_BASE_URL_MISSING')
  expect(() => readComfyUiBaseUrl({ COMFYUI_BASE_URL: 'http://user:pass@host:8188' })).toThrow('COMFYUI_BASE_URL_INVALID')
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm.cmd exec vitest run tests/unit/ai-providers/comfyui/config.test.ts`

Expected: FAIL because `src/lib/ai-providers/comfyui/config.ts` does not exist.

- [ ] **Step 3: Implement URL parsing and provider-config special handling**

`readComfyUiBaseUrl` must accept only `http:` or `https:` URLs, reject username/password/query/hash, strip trailing slashes, and throw `COMFYUI_BASE_URL_MISSING` or `COMFYUI_BASE_URL_INVALID`. The ComfyUI branch in `getProviderConfig` must call it and return `{ id: 'comfyui', name: 'ComfyUI', apiKey: '', baseUrl }`.

- [ ] **Step 4: Add the env examples and platform mapping**

Add:

```env
COMFYUI_BASE_URL=http://127.0.0.1:8188
```

Do not add `COMFYUI_API_KEY`. The platform provider map must identify ComfyUI as an environment-backed provider without requiring an API key.

- [ ] **Step 5: Run the focused test and typecheck**

Run: `npm.cmd exec vitest run tests/unit/ai-providers/comfyui/config.test.ts && npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai-providers/comfyui/config.ts tests/unit/ai-providers/comfyui/config.test.ts .env.example .env.cloud.example src/lib/deployment/platform-provider-env.json src/lib/user-api/runtime-config.ts src/lib/ai-registry/runtime-selection.ts
git commit -m "feat: configure ComfyUI from environment"
```

### Task 2: Add Codex as the text/image provider

**Files:**
- Create: `src/lib/ai-providers/codex/constants.ts`
- Create: `src/lib/ai-providers/codex/client.ts`
- Create: `src/lib/ai-providers/codex/image.ts`
- Create: `src/lib/ai-providers/codex/adapter.ts`
- Create: `src/lib/ai-providers/codex/models.ts`
- Create: `tests/unit/ai-providers/codex/client.test.ts`
- Create: `tests/unit/ai-providers/codex/adapter.test.ts`
- Modify: `src/lib/ai-providers/runtime-types.ts`
- Modify: `src/lib/ai-providers/index.ts`

**Interfaces:**
- `codexAdapter.providerKey === 'codex'`.
- `codexAdapter.image.execute` returns one `imageBase64`/data URL result and uses the upgraded Codex image-generation path.
- The existing Codex text/runtime path remains the text authority; any current model-gateway provider check must accept the Codex model identity and must not require OpenRouter.

- [ ] **Step 1: Port the focused Codex client tests from the working implementation**

Cover executable resolution, image-generation argument construction, timeout/error projection, and output-image discovery. Keep the tests independent of an installed Codex executable by mocking `child_process.spawn` and filesystem reads.

- [ ] **Step 2: Run the Codex tests and confirm the missing-module failure**

Run: `npm.cmd exec vitest run tests/unit/ai-providers/codex/client.test.ts tests/unit/ai-providers/codex/adapter.test.ts`

Expected: FAIL because the current branch has no Codex Provider adapter.

- [ ] **Step 3: Port the Codex client into the current provider namespace**

Port only the Codex executable/image-input/output logic needed by the current adapter. Keep subprocess execution server-side, use `windowsHide: true`, preserve bounded timeouts, and return sanitized errors without dumping full stdout/stderr into user-facing errors.

- [ ] **Step 4: Implement the Codex image adapter**

Normalize reference images through `normalizeToBase64ForGeneration`, invoke the Codex image-generation client, and map the generated bytes to the current `GenerateResult` contract. Do not create a second image-generation chain.

- [ ] **Step 5: Register Codex and remove the OpenRouter-only gate from Codex text routing**

Register `codexAdapter` in `src/lib/ai-providers/index.ts`. Update the Codex model-gateway selection so a `codex::...` model is accepted by the upgraded runtime path. Keep provider credentials out of the runtime gateway response.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm.cmd exec vitest run tests/unit/ai-providers/codex/client.test.ts tests/unit/ai-providers/codex/adapter.test.ts tests/unit/codex-runtime/provider-request-normalization.test.ts && npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai-providers/codex src/lib/ai-providers/runtime-types.ts src/lib/ai-providers/index.ts src/lib/codex-model-gateway tests/unit/ai-providers/codex tests/unit/codex-runtime
git commit -m "feat: register Codex text and image provider"
```

### Task 3: Add ComfyUI client, workflows, and media adapter

**Files:**
- Create: `src/lib/ai-providers/comfyui/client.ts`
- Create: `src/lib/ai-providers/comfyui/workflow-registry.ts`
- Create: `src/lib/ai-providers/comfyui/ltx23-workflow-profiles.ts`
- Create: `src/lib/ai-providers/comfyui/ltx23-workflow-router.ts`
- Create: `src/lib/ai-providers/comfyui/seedance2-bernini-workflow.ts`
- Create: `src/lib/ai-providers/comfyui/neutral-reference.ts`
- Create: `src/lib/ai-providers/comfyui/adapter.ts`
- Create: `src/lib/ai-providers/comfyui/models.ts`
- Create: `src/lib/ai-providers/comfyui/workflows/**` for the video and audio workflow JSON required by the registered models
- Create: `tests/unit/ai-providers/comfyui/client.test.ts`
- Create: `tests/unit/ai-providers/comfyui/workflow-registry.test.ts`
- Create: `tests/unit/ai-providers/comfyui/adapter.test.ts`

**Interfaces:**
- `comfyuiAdapter.video.execute`, `.music.execute`, and `.voice.execute` all call the same ComfyUI client and return the current `GenerateResult` contract.
- `runComfyUiWorkflow` submits `/prompt`, polls `/history/{prompt_id}`, chooses the expected media output, and downloads it through the existing safe outbound-media utilities.
- Workflow keys remain stable `comfyui::...` model keys.

- [ ] **Step 1: Add failing tests for URL use and workflow output selection**

Mock `fetch` and verify that every request uses the value from `COMFYUI_BASE_URL`, that `/prompt`, `/history/{id}`, and `/view` are called, and that video/audio outputs are selected by media type. Add failure cases for missing configuration, HTTP failure, timeout, and completed history without output.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm.cmd exec vitest run tests/unit/ai-providers/comfyui/client.test.ts tests/unit/ai-providers/comfyui/workflow-registry.test.ts tests/unit/ai-providers/comfyui/adapter.test.ts`

Expected: FAIL because the ComfyUI provider modules do not exist.

- [ ] **Step 3: Port the ComfyUI HTTP client and workflow registry**

Port the current `main` implementation into the current provider namespace, replacing any provider-config base URL input with `readComfyUiBaseUrl()`. Keep workflow prompt, reference-image, reference-audio, dimension, seed, and output-node preflight behavior. Do not port the legacy Generator classes.

- [ ] **Step 4: Port only the required workflow assets**

Include the registered video and audio workflow JSON files and their supporting profile modules. Do not include the `baseimage` workflows as public models; image generation remains Codex-owned.

- [ ] **Step 5: Implement the ComfyUI adapter**

Map current image/video/audio/voice inputs into the workflow injection contract. For voice, use the ComfyUI audio result path and return `audioUrl`/`audioBase64` with the detected MIME type. For video, pass reference images, audios, videos, duration, aspect ratio, and audio-generation flags.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm.cmd exec vitest run tests/unit/ai-providers/comfyui/client.test.ts tests/unit/ai-providers/comfyui/workflow-registry.test.ts tests/unit/ai-providers/comfyui/adapter.test.ts && npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai-providers/comfyui tests/unit/ai-providers/comfyui
git commit -m "feat: add ComfyUI video audio and voice provider"
```

### Task 4: Replace the catalogs and platform defaults

**Files:**
- Modify: `src/lib/ai-providers/builtin-catalog.ts`
- Modify: `src/lib/ai-registry/api-config-catalog.ts`
- Modify: `src/lib/ai-registry/platform-models.ts`
- Modify: `src/lib/ai-registry/pricing-catalog.ts`
- Modify: `src/lib/deployment/platform-provider-env.json`
- Modify: `src/lib/ai-exec/catalog-bootstrap.ts`
- Modify: `src/lib/user-api/api-config-defaults.ts`
- Modify: `src/lib/platform-models/catalog.ts`
- Create: `tests/contracts/codex-comfyui-catalog.contract.test.ts`
- Modify: `tests/contracts/provider-api-config-conformance.test.ts`
- Modify: existing provider-gateway capability tests to use Codex/ComfyUI fixtures

**Interfaces:**
- `API_CONFIG_CATALOG_PROVIDERS` contains exactly `codex` and `comfyui`.
- Built-in model keys contain no `ark::`, `openrouter::`, `fal::`, `google::`, `mureka::`, or `toonflow::` entries.
- Platform defaults point text/image to Codex and video/music/voice to ComfyUI.

- [ ] **Step 1: Write the catalog contract test**

Assert exact provider IDs, modality ownership, absence of removed provider keys, and that every catalog model resolves to a registered adapter.

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `npm.cmd exec vitest run tests/contracts/codex-comfyui-catalog.contract.test.ts tests/contracts/provider-api-config-conformance.test.ts`

Expected: FAIL because the current catalogs still expose the old providers.

- [ ] **Step 3: Replace provider/model catalog composition**

Register only Codex and ComfyUI catalog entries. Keep Codex text/image entries and ComfyUI video/music/voice entries. Remove old Provider entries from the catalog composition, but do not modify historical database rows.

- [ ] **Step 4: Update platform model defaults and pricing entries**

Point platform defaults to the new canonical model keys and remove pricing imports that only support removed providers. Preserve the existing pricing contract shape for billing.

- [ ] **Step 5: Run contract checks**

Run: `npm.cmd exec vitest run tests/contracts/codex-comfyui-catalog.contract.test.ts tests/contracts/provider-api-config-conformance.test.ts && npm.cmd run check:capability-catalog && npm.cmd run check:pricing-catalog && npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai-providers/builtin-catalog.ts src/lib/ai-registry src/lib/deployment/platform-provider-env.json src/lib/user-api/api-config-defaults.ts src/lib/platform-models/catalog.ts tests/contracts
git commit -m "refactor: converge provider catalogs on Codex and ComfyUI"
```

### Task 5: Remove old Provider runtime and UI exposure

**Files:**
- Delete: `src/lib/ai-providers/ark/**`
- Delete: `src/lib/ai-providers/fal/**`
- Delete: `src/lib/ai-providers/google/**`
- Delete: `src/lib/ai-providers/mureka/**`
- Delete: `src/lib/ai-providers/openrouter/**`
- Delete: `src/lib/ai-providers/toonflow/**`
- Modify: `src/lib/ai-providers/index.ts`
- Modify: `src/lib/ai-exec/session.ts`
- Modify: `src/lib/ai-exec/media-result.ts`
- Modify: `src/lib/billing/subscription-capacity.ts`
- Modify: `src/app/[locale]/profile/components/api-config/types.ts`
- Modify: `src/app/[locale]/profile/components/api-config-tab/hooks/useApiConfigFilters.ts`
- Modify: `src/app/[locale]/profile/components/api-config/provider-card/ProviderAdvancedFields.tsx`
- Modify: `src/app/[locale]/profile/components/api-config/provider-card/types.ts`
- Delete or rewrite provider-specific tests under `tests/integration/provider/**`
- Modify: `tests/helpers/fakes/providers.ts`

**Interfaces:**
- No runtime registry import references a removed provider.
- The profile API configuration screen exposes only Codex and ComfyUI.
- Stored historical provider rows are ignored by normalization instead of being deleted.

- [ ] **Step 1: Add a repository-level stale-provider scan test**

Create a contract test that imports the catalogs and adapter registry, asserts exact allowed provider keys, and checks that no public API-config provider name contains a removed provider key.

- [ ] **Step 2: Run the scan and record the failing references**

Run: `npm.cmd exec vitest run tests/contracts/codex-comfyui-catalog.contract.test.ts`

Expected: FAIL while old runtime/UI registrations remain.

- [ ] **Step 3: Remove old runtime registrations and provider-specific session/result code**

Remove old adapter/async-task registrations and update shared code to use generic provider metadata. Delete imports that only existed for OpenRouter, including old session and realtime-billing helpers, after confirming no remaining consumer.

- [ ] **Step 4: Remove old UI provider filters/tutorials and add ComfyUI environment status**

Change filters, provider cards, and modality lists so Codex shows text/image and ComfyUI shows video/audio/voice. ComfyUI status must report configured when `COMFYUI_BASE_URL` is valid; it must not ask for an API key or allow editing the address in the browser.

- [ ] **Step 5: Remove obsolete provider tests and update fixtures**

Delete tests whose only purpose is an unsupported provider. Update shared fixtures and retained contract tests to use `codex::...` and `comfyui::...` keys.

- [ ] **Step 6: Run stale-reference scans and typecheck**

Run: `rg -n -i "ark::|openrouter::|fal::|google::|mureka::|toonflow::|PLATFORM_(ARK|OPENROUTER|FAL|GOOGLE|MUREKA|TOONFLOW)" src tests scripts --glob '!**/migrations/reports/**'`; then run `npm.cmd run typecheck`.

Expected: only explicitly retained historical/migration references remain, and typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add -A src tests package.json package-lock.json
git commit -m "refactor: remove unsupported AI providers"
```

### Task 6: Dependency, environment, and regression verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `README_en.md`
- Modify: `.env.example`
- Modify: `.env.cloud.example`
- Create: `tests/integration/provider/codex-comfyui-routing.contract.test.ts`

- [ ] **Step 1: Write routing contract tests**

Mock the Codex and ComfyUI adapters and assert:

```ts
expect(await executeMediaGeneration({ modality: 'image', userId, modelKey: 'codex::gpt-image-2', prompt: 'x' })).toMatchObject({ success: true })
expect(await executeMediaGeneration({ modality: 'video', userId, modelKey: 'comfyui::basevideo/seedance2/bernini-480p-i2v', imageUrl: reference })).toMatchObject({ success: true })
```

Also assert missing/invalid `COMFYUI_BASE_URL` fails before any network request.

- [ ] **Step 2: Remove unused dependencies**

Use `rg` to verify that removed SDK packages have no remaining imports, then remove only packages that are unused after provider cleanup. Run `npm.cmd install --package-lock-only` and keep the lockfile consistent.

- [ ] **Step 3: Update operator documentation**

Document `COMFYUI_BASE_URL`, the modality ownership table, and the fact that old database credentials are ignored rather than deleted.

- [ ] **Step 4: Run the full relevant verification set**

Run:

```bash
npm.cmd run typecheck
npm.cmd run lint:all
npm.cmd run check:capability-catalog
npm.cmd run check:pricing-catalog
npm.cmd run check:model-config-contract
npm.cmd exec vitest run tests/contracts tests/unit/ai-providers tests/unit/ai-registry tests/unit/ai-exec
```

Expected: PASS, or an explicitly documented baseline/environment failure unrelated to the changed files.

- [ ] **Step 5: Run the real-provider smoke checks when services are available**

With `COMFYUI_BASE_URL` set and the upgraded Codex runtime available, run one text request, one Codex image request, one ComfyUI video request, one ComfyUI audio request, and one ComfyUI voice request. Record the result IDs and returned media MIME types without logging secrets.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json README.md README_en.md .env.example .env.cloud.example tests/integration/provider/codex-comfyui-routing.contract.test.ts
git commit -m "test: verify Codex and ComfyUI routing"
```

## Final review checklist

- [ ] `git diff --check` passes.
- [ ] `npm.cmd run typecheck` passes.
- [ ] Relevant Vitest suites pass.
- [ ] Old providers are absent from the runtime registry and UI catalog.
- [ ] `COMFYUI_BASE_URL` is the only ComfyUI address source.
- [ ] Existing unrelated working-tree changes in the parent checkout are untouched.

