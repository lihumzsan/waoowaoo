# Workspace Performance and Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the video stage responsive for large episodes and keep large video uploads/ComfyUI transfers out of the Node.js heap.

**Architecture:** Limit the mounted video-card working set with client-side pagination while retaining the complete panel array for linking and batch operations. Scope automatic first/last-frame prompt work to the visible page, cap its concurrency, stop mutation-wide cache invalidation, and make recovery probes distinguish an empty successful lookup from a transport failure. Replace the video-tools multipart/Buffer path with a raw request stream, add streaming storage writes, stream inputs to ComfyUI, and persist ComfyUI outputs from their response stream.

**Tech Stack:** Next.js 15, React 19, TypeScript, TanStack Query, Vitest, AWS SDK v3/MinIO, Web Streams, Playwright.

## Global Constraints

- Work in the user-approved current `main` checkout; do not create another branch or worktree.
- Do not add a runtime dependency for pagination, multipart parsing, or streaming.
- Preserve first/last-frame linking, manual prompt regeneration, voice-line location, batch generation, and video-tools trim behavior.
- Keep the default development loop host-based and make warmup opt-in.
- Reject oversized video-tools uploads before consuming their request body when `Content-Length` is present.
- Keep repository credentials and external-system secrets out of source, tests, logs, and this plan.
- Follow red-green-refactor for every production behavior change and run standard automated plus browser evidence.

## Business Scope / Out of Scope

In scope:

- Default development startup, video-stage card rendering, image loading animation, first/last-frame prompt scheduling/cache behavior, empty recovery polling, video-tools upload, ComfyUI input forwarding, and ComfyUI seam-concat output persistence.
- Desktop and mobile visual smoke coverage for the changed video-stage pagination.

Out of scope:

- Changing generation models, prompt semantics, database schema, storage credentials, ComfyUI workflows, or the general image/audio upload APIs that intentionally transform small media in memory.
- Replacing React Query, the worker queue, MinIO, or Next.js.

## Acceptance Mapping

| Acceptance | Evidence |
| --- | --- |
| `npm run dev` no longer launches warmup | package script test/static assertion and process command review |
| Successful empty recovery lookup does not retry after 2 seconds; failures back off | `tests/unit/helpers/recovery-probe.test.ts` with fake timers |
| First/last-frame automatic work is limited to visible panels with at most two concurrent calls | focused queue unit test and video-stage runtime test |
| One prompt completion no longer invalidates all project/episode/video queries | `tests/unit/query/first-last-frame-prompt-cache.test.ts` |
| At most 24 heavy cards mount per video-stage page and voice-line location reveals the correct page | pagination and viewport unit tests plus browser DOM count |
| Offscreen loading placeholders are static and stable `/m/` images use optimized derivatives | media component unit tests and browser resource/animation inspection |
| Video-tools request and storage transfer use streams instead of `request.formData()`/`File.arrayBuffer()` | API contract and storage provider tests |
| Seam-concat input/output does not cross worker boundaries as full base64 video buffers | ComfyUI client and worker tests |
| TypeScript, lint, focused tests, and production build remain green | repository verification commands |
| Video-stage interaction and layout remain usable | Playwright desktop/mobile screenshots and request/DOM measurements |

## Risks, Rollback and Observation

- Pagination changes which cards are mounted. Voice-line navigation must select the target page before scrolling; otherwise rollback the pagination commit while retaining CSS containment.
- Streaming S3 uploads require a known content length for the video-tools browser upload. Missing or mismatched lengths return a contract error instead of falling back to buffering.
- ComfyUI streaming multipart must preserve the existing `/upload/image` field names and returned filename contract. A focused mocked transport test guards the wire shape.
- Observe browser DOM/node count, empty `/api/runs` request frequency, prompt POST concurrency, Next physical memory, worker RSS, and system swap during the large 188-panel episode smoke test.
- Every change is source-only and reversible by restoring the touched files; there is no schema or data migration.

## Delivery Metadata

- Plan Path: `docs/superpowers/plans/2026-07-18-workspace-performance-and-streaming.md`
- Plan Status: complete
- Evidence Profile: standard
- Story ID: none (ZenTao was not requested)
- Task IDs: none; Superpowers Tasks 1-5 are tracked in this file
- ZenTao Sync Status: not-synced
- ZenTao Readback Evidence / Time: none
- Last Updated: 2026-07-18

---

### Task 1: Development Startup and Recovery Probe

**Files:**
- Modify: `package.json`
- Modify: `src/lib/query/hooks/run-stream/recovery-probe.ts`
- Modify: `src/lib/query/hooks/useStoryToScriptRunStream.ts`
- Modify: `src/lib/query/hooks/useScriptToStoryboardRunStream.ts`
- Test: `tests/unit/helpers/recovery-probe.test.ts`
- Test: `tests/unit/dev-startup-script.test.ts`

**Interfaces:**
- Consumes: existing `startRecoveryProbe()` callback returning `string | null`.
- Produces: 60-second cooldown for a successful empty lookup and exponential retry only for thrown lookup failures.

- [x] **Step 1: Write failing startup and recovery tests**

```ts
expect(packageJson.scripts.dev).not.toContain('dev:warmup')
expect(packageJson.scripts['dev:warmup']).toBeDefined()

resolveActiveRunId.mockResolvedValue(null)
await vi.advanceTimersByTimeAsync(PROBE_RETRY_INTERVAL_MS)
expect(resolveActiveRunId).toHaveBeenCalledTimes(1)
await vi.advanceTimersByTimeAsync(PROBE_SUCCESS_COOLDOWN_MS - PROBE_RETRY_INTERVAL_MS)
expect(resolveActiveRunId).toHaveBeenCalledTimes(2)
```

- [x] **Step 2: Run the tests and confirm they fail for the current warmup/retry behavior**

Run: `npx vitest run tests/unit/dev-startup-script.test.ts tests/unit/helpers/recovery-probe.test.ts`

Expected: startup still contains `dev:warmup`, and an empty probe retries at 2 seconds.

- [x] **Step 3: Make warmup opt-in and split probe success from errors**

```ts
// package.json
"dev": "npm run storage:init && concurrently \"npm run dev:next\" \"npm run dev:worker\" \"npm run dev:watchdog\" \"npm run dev:board\"",
"dev:full": "concurrently \"npm run dev\" \"npm run dev:warmup\""

// recovery-probe.ts
try {
  const activeRunId = await args.resolveActiveRunId(context)
  successfulProbeScopes.set(args.storageKey, Date.now())
  if (!activeRunId) scheduleRetry(PROBE_SUCCESS_COOLDOWN_MS)
} catch {
  scheduleRetry(nextRetryDelayMs)
  nextRetryDelayMs = Math.min(nextRetryDelayMs * 2, PROBE_SUCCESS_COOLDOWN_MS)
}
```

Make both run-stream resolvers throw for non-2xx or malformed responses so only a confirmed empty `runs` array is treated as success.

- [x] **Step 4: Run focused tests and confirm green**

Run: `npx vitest run tests/unit/dev-startup-script.test.ts tests/unit/helpers/recovery-probe.test.ts`

Expected: all tests pass and no 2-second retry follows a successful empty result.

### Task 2: Prompt Scheduling and Cache Storm

**Files:**
- Create: `src/lib/novel-promotion/stages/video-stage-runtime/prompt-auto-ensure-queue.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow.ts`
- Modify: `src/lib/query/mutations/useVideoMutations.ts`
- Test: `tests/unit/novel-promotion/prompt-auto-ensure-queue.test.ts`
- Test: `tests/unit/query/first-last-frame-prompt-cache.test.ts`

**Interfaces:**
- Consumes: visible panel keys from Task 3 and existing `ensurePrompt(panelKey, reason)`.
- Produces: `runPromptAutoEnsureQueue(keys, ensure, options)` with maximum concurrency 2 and cancellation support.

- [x] **Step 1: Write failing queue and invalidation tests**

```ts
await runPromptAutoEnsureQueue(['a', 'b', 'c', 'd'], ensure, { concurrency: 2 })
expect(maxActive).toBe(2)
expect(completed).toEqual(['a', 'b', 'c', 'd'])

expect(generateMutationOptions.onSettled).toBeUndefined()
```

- [x] **Step 2: Run the tests and confirm the missing queue/per-mutation invalidation failure**

Run: `npx vitest run tests/unit/novel-promotion/prompt-auto-ensure-queue.test.ts tests/unit/query/first-last-frame-prompt-cache.test.ts`

Expected: queue module is missing and generation still installs a global `onSettled` invalidation.

- [x] **Step 3: Implement the bounded visible-panel queue**

```ts
export async function runPromptAutoEnsureQueue(
  panelKeys: readonly string[],
  ensure: (panelKey: string) => Promise<void>,
  options: { concurrency?: number; isCancelled?: () => boolean } = {},
) {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, panelKeys.length || 1))
  let cursor = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!options.isCancelled?.() && cursor < panelKeys.length) {
      const panelKey = panelKeys[cursor++]
      await ensure(panelKey)
    }
  }))
}
```

Filter automatic candidates by `visiblePanelKeys`, call the queue with concurrency 2, and remove `useGenerateFirstLastFramePrompt()`'s per-request `onSettled`. Keep explicit cache invalidation for user edits that still depend on server rereads.

- [x] **Step 4: Run focused prompt tests and confirm green**

Run: `npx vitest run tests/unit/novel-promotion/prompt-auto-ensure-queue.test.ts tests/unit/query/first-last-frame-prompt-cache.test.ts tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

Expected: all tests pass with bounded order and without mutation-wide invalidation.

### Task 3: Bounded Video-Card Rendering and Image Work

**Files:**
- Create: `src/lib/novel-promotion/stages/video-stage-runtime/video-panel-pagination.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime-core.tsx`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelViewport.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoRenderPanel.tsx`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardHeader.tsx`
- Modify: `src/components/media/MediaImageWithLoading.tsx`
- Modify: `src/components/media/MediaImage.tsx`
- Modify: `messages/zh/video.json`
- Modify: `messages/en/video.json`
- Test: `tests/unit/novel-promotion/video-panel-pagination.test.ts`
- Test: `tests/unit/components/media-image-with-loading.test.ts`

**Interfaces:**
- Produces: `VIDEO_PANEL_PAGE_SIZE = 24`, `getVideoPanelPage()`, and `paginateVideoPanels()`.
- Produces: `useVideoPanelViewport({ revealPanel })`, which reveals a page before its double-animation-frame scroll.
- Consumes: visible page keys in Task 2.

- [x] **Step 1: Write failing pagination and placeholder-animation tests**

```ts
expect(paginateVideoPanels(panels, 1).items).toHaveLength(24)
expect(getVideoPanelPage(panels, 'story-49')).toBe(3)
expect(shouldAnimateImagePlaceholder(true, false)).toBe(false)
expect(shouldAnimateImagePlaceholder(true, true)).toBe(true)
```

- [x] **Step 2: Run tests and confirm the helpers do not exist**

Run: `npx vitest run tests/unit/novel-promotion/video-panel-pagination.test.ts tests/unit/components/media-image-with-loading.test.ts`

Expected: imports fail because bounded pagination and visibility-aware animation are not implemented.

- [x] **Step 3: Implement pagination, page-aware location, containment, and thumbnails**

Render only the current 24-panel slice while using global indexes for link/previous/next semantics. On voice-line location, set the target page first and scroll after two animation frames. Add `contentVisibility: 'auto'` and `containIntrinsicSize: '0 720px'` to each card wrapper. Observe the loading wrapper with a 300px root margin; render a static placeholder offscreen and animate only near the viewport. Remove `unoptimized` from stable `/m/` Next images and pass responsive `sizes` from the video card.

- [x] **Step 4: Run focused component tests and confirm green**

Run: `npx vitest run tests/unit/novel-promotion/video-panel-pagination.test.ts tests/unit/components/media-image-with-loading.test.ts tests/unit/novel-promotion/video-panel-card-header.test.ts`

Expected: all tests pass, global panel indexes remain intact, and at most 24 cards are returned per page.

### Task 4: Stream Video-Tools and ComfyUI Media

**Files:**
- Modify: `src/lib/storage/types.ts`
- Modify: `src/lib/storage/index.ts`
- Modify: `src/lib/storage/providers/local.ts`
- Modify: `src/lib/storage/providers/minio.ts`
- Modify: `src/app/api/video-tools/uploads/route.ts`
- Modify: `src/app/[locale]/workspace/video-tools/page.tsx`
- Modify: `src/lib/providers/comfyui/client.ts`
- Modify: `src/lib/workers/handlers/video-seam-concat.ts`
- Test: `tests/integration/api/contract/video-tools-routes.test.ts`
- Test: `tests/unit/storage/minio-provider.test.ts`
- Test: `tests/unit/providers/comfyui-client.test.ts`
- Test: `tests/unit/worker/video-seam-concat.test.ts`

**Interfaces:**
- Produces: `uploadObjectStream(body, key, contentLength, contentType)`.
- Changes browser upload contract to raw file bytes with `x-file-name`, automatic `Content-Length`, and the file MIME type.
- Changes seam-concat ComfyUI result from `{ videoBase64 }` to `{ videoUrl, mimeType, contentLength? }`.

- [x] **Step 1: Write failing stream-contract tests**

```ts
expect(uploadObjectStreamMock).toHaveBeenCalledWith(
  expect.any(ReadableStream), expect.stringContaining('/inputs/'), 3, 'video/mp4',
)
expect(request.formData).not.toHaveBeenCalled()
expect(workerUploadStreamMock).toHaveBeenCalledWith(expect.any(ReadableStream), expect.any(String), 123, 'video/mp4')
```

- [x] **Step 2: Run tests and confirm current Buffer/base64 behavior fails**

Run: `npx vitest run tests/integration/api/contract/video-tools-routes.test.ts tests/unit/storage/minio-provider.test.ts tests/unit/providers/comfyui-client.test.ts tests/unit/worker/video-seam-concat.test.ts`

Expected: upload route calls `formData()`/`arrayBuffer()`, storage has no stream API, and the worker decodes a full base64 output.

- [x] **Step 3: Implement raw request and storage streaming**

Validate filename, MIME, and `Content-Length` before consuming `request.body`. Pass the web stream directly to MinIO with `ContentLength`; convert it to a Node readable and use `pipeline()` for local storage. The browser sends the `File` directly as the fetch body and encodes its name in `x-file-name`.

- [x] **Step 4: Implement ComfyUI input/output streaming**

Build the existing `/upload/image` multipart envelope as a streaming body around the upstream signed-object response rather than converting it to `Buffer`/`Blob`. Return the ComfyUI `/view` URL and headers for seam-concat output; the worker fetches that URL and streams it to storage without base64 conversion.

- [x] **Step 5: Run focused stream tests and confirm green**

Run: `npx vitest run tests/integration/api/contract/video-tools-routes.test.ts tests/unit/storage/minio-provider.test.ts tests/unit/providers/comfyui-client.test.ts tests/unit/worker/video-seam-concat.test.ts`

Expected: all tests pass and no tested seam-concat path exposes a full video `Buffer` or base64 payload.

### Task 5: Full Verification and Runtime Acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-workspace-performance-and-streaming.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: delivery evidence and remaining-risk record.

- [x] **Step 1: Run static and automated verification**

Run:

```bash
npm run typecheck
npm run lint:all
npm run test:unit:all
npm run test:integration:api -- --run tests/integration/api/contract/video-tools-routes.test.ts
npm run build
git diff --check
```

Expected: exit code 0 for every applicable command.

- [x] **Step 2: Run the authenticated large-episode Playwright smoke**

Open the known project episode at `stage=videos`, record click latency, DOM count, mounted panel count, `/api/runs` cadence, prompt POST concurrency, image requests, browser task duration, Next RSS, worker RSS, and swap. Navigate pages and use a voice-line locate action that targets a non-current page.

Expected: no more than 24 heavy video cards mounted, no 2-second empty-run polling, no prompt request burst above two concurrent requests, and a materially lower settled main-thread duty than the pre-fix 1,042ms per 10 seconds.

- [x] **Step 3: Capture desktop and mobile screenshots**

Expected: pagination remains reachable and aligned, cards do not overflow, global shot numbers are correct, and the mobile viewport has no horizontal page overflow.

- [x] **Step 4: Review the diff and update the delivery record**

Record exact commands/results, screenshot paths, runtime measurements, deviations, risks, and process ownership below. Do not mark complete when any required evidence is missing.

## Delivery Record

### Delivered changes

- Default `npm run dev` now starts Next, workers, watchdog, and Bull Board without eager warmup. `dev:full` remains available when warmup is explicitly wanted.
- Recovery probing treats only a confirmed empty `runs` array as a successful empty lookup, waits 60 seconds after that result, and uses short exponential backoff only for thrown request/parse failures.
- Automatic first/last-frame prompt creation is persistent across React rerenders, deduplicates queued/active keys, is scoped to the visible page, and never exceeds two active requests. A generation completion no longer invalidates the whole project/episode/video query set.
- The 188-panel video stage mounts 24 cards per page while preserving global panel indexes, cross-page first/last linking, batch operations, and page-aware voice-line location. Stable media images use Next derivatives and offscreen placeholders do not animate.
- Browser video-tools upload, local/MinIO storage, ComfyUI multipart input, and seam-concat output persistence use streaming paths with length validation, path containment, atomic local writes, and cleanup/cancellation on failure.
- Browser QA exposed an additional narrow-viewport overflow. Commit `28efdf83` makes the global navbar, capsule stage navigation, language action, and video toolbar responsive without changing the desktop workflow.
- The stale Goon duration test was aligned with the already-intentional 4-15 second production contract in commit `5eea866e`; production model behavior was not changed.
- Final review found two lifecycle edges: stale queued prompts after a visible-page change and recovery backoff that remained elevated after success. Commit `586f7c6e` fixes both, adds regression coverage, and passed re-review without blocking findings.

### Automated verification

| Command | Result |
| --- | --- |
| `npm run test:unit:all` | 300 files and 1,314 tests passed. |
| `npm run lint` | Exit 0; 0 errors and 12 pre-existing unused-variable warnings. |
| `npm run typecheck` | Exit 0. |
| `npm run build` | Exit 0; Next.js production build completed and generated 72 static pages. |
| `BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/api/contract/video-tools-routes.test.ts --reporter=dot` | 1 file and 10 upload/length/stream contract tests passed against `waoowaoo_test` on `192.168.0.112:13306`. |
| `git diff --check` | Exit 0. |

The direct Vitest form was used for the single video-tools contract because the npm integration script does not expose a reliable single-file filter. Storage initialization also verified the configured MinIO bucket before the final dev service started.

### Authenticated browser/runtime evidence

Large episode: project `蛊真人后传`, episode `第002章 炼道尊者的价码`, 188 panels / 182 generated videos.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Mounted heavy cards / images | 188 / 189 | 24 / 24 | about 87% lower |
| DOM elements | 14,755 | 2,098 | about 86% lower |
| CDP nodes | 53,499 | 5,630 | about 89% lower |
| Buttons | 1,511 | 211 | about 86% lower |
| Browser JS heap | 75-84 MiB | 45.4 MiB settled | about 39-46% lower |
| Settled main-thread task time | 1.042 s / 10 s | 0.070 s / 10 s | about 93% lower |
| Empty `/api/runs` traffic | repeated at roughly 2 seconds (19 observed) | 0 requests in the settled 10-second window | burst removed |
| Automatic prompt calls | 15-call burst | 9 missing prompts, maximum concurrency 2 | bounded |

- A cold authenticated refresh completed with 2,087 DOM elements, 5,662 CDP nodes, 24 mounted shots, zero animated loaders in the main content, and no horizontal overflow.
- Page 2 mounted exactly shots 25-48. Clicking the 31st `定位视频` action from page 1 switched to page 4 and revealed shots 73-96, proving the voice-line path reveals the target page before scrolling.
- Desktop `1440x900` and mobile `390x844` both had zero document overflow. Mobile navbar/stage controls and the video action toolbar remained reachable without overlapping.
- After a clean service restart and one route compilation, Next's physical footprint was 1.7 GiB (2.2 GiB peak). This remains the main unavoidable dev-mode compiler cost, but it no longer combines with a 188-card browser tree or eager startup warmup.

Screenshots:

- `/Users/tigli/.codex/visualizations/2026/07/18/019f7402-5ec0-76b1-9e7f-05c7b0681a47/waoowaoo-performance/video-stage-desktop-page1.png`
- `/Users/tigli/.codex/visualizations/2026/07/18/019f7402-5ec0-76b1-9e7f-05c7b0681a47/waoowaoo-performance/video-stage-desktop-page2.png`
- `/Users/tigli/.codex/visualizations/2026/07/18/019f7402-5ec0-76b1-9e7f-05c7b0681a47/waoowaoo-performance/video-stage-mobile-toolbar.png`
- `/Users/tigli/.codex/visualizations/2026/07/18/019f7402-5ec0-76b1-9e7f-05c7b0681a47/waoowaoo-performance/video-stage-voice-locate-page4.png`

### Remaining risk and process ownership

- The streaming code is covered by real HTTP/AWS middleware and route contracts, and the configured MinIO endpoint was reached, but this verification intentionally did not submit a new expensive live ComfyUI generation job. A future manual large-file smoke can validate the exact external ComfyUI workflow without changing the implementation contract.
- Final service ownership: this session started `npm run dev`; it is intentionally left running at `http://localhost:3000/zh` after verification. Default startup does not include warmup.

### Actual Implementation

- Tasks 1-5 are complete on the local `main` branch. The final reviewer marked the delivery ready to merge after the prompt-queue and recovery-backoff follow-up; its two optional queue-lifecycle test edges were added in `fb968350`.

### Plan Deviations

- Browser QA added a scoped responsive-navigation fix because the existing mobile toolbar and top navigation overflowed at `390x844`.
- The single video-tools integration contract was run directly through Vitest because the npm integration wrapper does not reliably accept a single-file filter.

### Impact

- The large episode now mounts one 24-card page instead of all 188 cards, bounds automatic prompt work to two active requests, removes settled empty-run request churn, and streams large video bodies rather than materializing them in application memory.

### Verification

- Automated, authenticated browser, desktop/mobile visual, and reviewer verification are recorded above. Pre-fix evidence was 188 mounted cards, 14,755 DOM elements, 53,499 browser nodes, 15 automatic prompt POSTs, 19 duplicate run lookups, settled main-thread task duration 1,042ms/10s, Next physical footprint peak 2.7GB, and swap growth to about 6.76GB.

### Remaining Risks

- Dev-mode Next compilation remains the largest local memory consumer. A fresh external ComfyUI generation was intentionally not submitted; the complete upload/download streaming chain is instead covered by route, storage, client, and worker contracts against the configured remote test infrastructure.

### Follow-ups

- None outside the approved scope.

### ZenTao Closeout

- Not synced; the user requested direct local implementation and did not request ZenTao operations.
