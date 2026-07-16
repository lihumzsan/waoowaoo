# Video Seam Concat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone authenticated page that uploads two videos, runs the bundled ComfyUI seam-concat NVENC workflow asynchronously, persists the output, and restores recent results.

**Architecture:** Extend the existing ComfyUI workflow registry with ordered `LoadVideo.file` injection and add a focused seam-concat client entrypoint. Submit a new `video_seam_concat` task to the existing video queue; a dedicated handler resolves user-scoped storage inputs, calls ComfyUI, and persists the MP4. A new `/workspace/video-tools` client page owns upload previews and task/result presentation while reusing the authenticated task API.

**Tech Stack:** Next.js App Router, React, TypeScript, next-intl, Prisma task records, BullMQ video worker, project storage abstraction, ComfyUI HTTP API, Vitest.

## Global Constraints

- The route is `/workspace/video-tools` and the navigation label is `视频工具` / `Video Tools`.
- The fixed workflow key is `basevideo/tools/video-seam-concat-nvenc`.
- Node `1` receives Video 1 and node `2` receives Video 2 through `LoadVideo.file`.
- The output remains `video/nvenc_h264-mp4`, `yuv420p`, 10 Mbit/s, with Video 1 FPS.
- Uploads must be authenticated, user-scoped, non-empty, supported video files, and at most 256 MiB each.
- The browser must not call ComfyUI directly or receive its base URL.
- Do not add a workflow picker, encoding controls, trim controls, batch mode, or a database migration.
- Do not show a cancel control or fake progress percentage.

---

### Task 1: Register and inject the seam-concat workflow

**Files:**
- Create: `src/lib/providers/comfyui/workflows/basevideo/tools/video-seam-concat-nvenc.json`
- Modify: `src/lib/providers/comfyui/workflow-registry.ts`
- Test: `tests/unit/providers/comfyui-workflow-registry.test.ts`

**Interfaces:**
- Consumes: existing `resolveComfyUiWorkflow(workflowKey, inject)`.
- Produces: `ComfyUiWorkflowInject.videoFilenames?: string[]` and `getComfyUiWorkflowVideoInputCount(workflowKey): number`.

- [ ] **Step 1: Write failing workflow registry tests**

Add tests that resolve `basevideo/tools/video-seam-concat-nvenc` with `videoFilenames: ['first.mp4', 'second.mp4']` and assert node `1.inputs.file === 'first.mp4'`, node `2.inputs.file === 'second.mp4'`, both `upload` fields are absent, node `5` still starts at node `4`, and node `9` remains `VHS_VideoCombine` with NVENC format. Add a count assertion equal to `2`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx.cmd vitest run tests/unit/providers/comfyui-workflow-registry.test.ts`

Expected: TypeScript/test failure because `videoFilenames` and `getComfyUiWorkflowVideoInputCount` do not exist and the workflow key is not registered.

- [ ] **Step 3: Add the API workflow graph and minimal injection**

Create the nine-node API graph from the supplied workflow’s `extra.prompt`. Add `videoFilenames` to `ComfyUiWorkflowInject`, implement ordered `LoadVideo` injection using `file`, delete UI-only `upload`, call it inside `resolveComfyUiWorkflow`, and export the input counter.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx.cmd vitest run tests/unit/providers/comfyui-workflow-registry.test.ts`

Expected: all workflow registry tests pass.

- [ ] **Step 5: Commit**

Run: `git add src/lib/providers/comfyui/workflows/basevideo/tools/video-seam-concat-nvenc.json src/lib/providers/comfyui/workflow-registry.ts tests/unit/providers/comfyui-workflow-registry.test.ts && git commit -m "feat: register video seam concat workflow"`

### Task 2: Add the ComfyUI seam-concat client contract

**Files:**
- Modify: `src/lib/providers/comfyui/client.ts`
- Test: `tests/unit/providers/comfyui-client.test.ts`

**Interfaces:**
- Consumes: `resolveComfyUiWorkflow`, generic binary loading, `/upload/image`, `/prompt`, `/history`, and `/view` behavior.
- Produces: `runComfyUiVideoSeamConcatWorkflow(params: { baseUrl: string; workflowKey?: string; videoUrls: [string, string] }): Promise<{ videoBase64: string; mimeType: string }>`.

- [ ] **Step 1: Write a failing client test**

Mock fetch so two source URLs return MP4 buffers, two `/upload/image` calls return `first.mp4` and `second.mp4`, `/prompt` returns a prompt id, `/history/<id>` returns a `VHS_VideoCombine` MP4 output, and `/view` returns output bytes. Assert both uploads happen before prompt submission and the submitted graph contains the two injected filenames.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx.cmd vitest run tests/unit/providers/comfyui-client.test.ts`

Expected: import failure for `runComfyUiVideoSeamConcatWorkflow`.

- [ ] **Step 3: Implement the minimal client function**

Factor the existing upload routine into a media-neutral internal function while preserving the multipart field name `image`, add ordered video uploads, resolve the fixed workflow with `videoFilenames`, and run it with `expect: 'video'`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx.cmd vitest run tests/unit/providers/comfyui-client.test.ts`

Expected: all ComfyUI client tests pass.

- [ ] **Step 5: Commit**

Run: `git add src/lib/providers/comfyui/client.ts tests/unit/providers/comfyui-client.test.ts && git commit -m "feat: run two-video concat in ComfyUI"`

### Task 3: Add authenticated upload and task submission APIs

**Files:**
- Create: `src/lib/video-tools/seam-concat.ts`
- Create: `src/app/api/video-tools/uploads/route.ts`
- Create: `src/app/api/video-tools/seam-concat/route.ts`
- Test: `tests/unit/video-tools/seam-concat.test.ts`
- Test: `tests/integration/api/contract/video-tools-routes.test.ts`

**Interfaces:**
- Produces: `VIDEO_TOOLS_PROJECT_ID`, `VIDEO_SEAM_CONCAT_WORKFLOW_KEY`, `buildVideoToolInputKey(userId, ext)`, `isOwnedVideoToolInputKey(userId, key)`, and strict request parsers.
- Upload response: `{ success: true, key: string, url: string, name: string, size: number, mimeType: string }`.
- Submit response: existing `submitTask` async result with a `taskId`.

- [ ] **Step 1: Write failing validation and route tests**

Cover supported extensions (`mp4`, `mov`, `webm`, `mkv`), empty files, unsupported MIME/extensions, the 256 MiB limit, user-scoped key ownership, missing authentication, missing input keys, and a valid two-key submission that calls `submitTask` with project id `video-tools` and type `video_seam_concat`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx.cmd vitest run tests/unit/video-tools/seam-concat.test.ts tests/integration/api/contract/video-tools-routes.test.ts`

Expected: module/route imports fail because the feature files do not exist.

- [ ] **Step 3: Implement upload and submit routes**

Use `requireUserAuth`, `apiHandler`, `request.formData()`, `uploadObject`, `getSignedUrl`, `resolveRequiredTaskLocale`, and `submitTask`. Use a random target id, one attempt, no cross-user keys, and a dedupe key based on target id.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx.cmd vitest run tests/unit/video-tools/seam-concat.test.ts tests/integration/api/contract/video-tools-routes.test.ts`

Expected: all new API and validation tests pass.

- [ ] **Step 5: Commit**

Run: `git add src/lib/video-tools/seam-concat.ts src/app/api/video-tools tests/unit/video-tools/seam-concat.test.ts tests/integration/api/contract/video-tools-routes.test.ts && git commit -m "feat: add video tool upload and submit APIs"`

### Task 4: Execute and persist the seam-concat task

**Files:**
- Modify: `src/lib/task/types.ts`
- Modify: `src/lib/task/queues.ts`
- Modify: `src/lib/task/intent.ts`
- Modify: `src/lib/task/progress-message.ts`
- Modify: `src/lib/workers/video.worker.ts`
- Create: `src/lib/workers/handlers/video-seam-concat.ts`
- Test: `tests/unit/worker/video-seam-concat.test.ts`
- Modify: task-type coverage fixtures identified by `npm.cmd run check:test-tasktype-coverage`.

**Interfaces:**
- Produces: `TASK_TYPE.VIDEO_SEAM_CONCAT === 'video_seam_concat'` routed to the video queue.
- Handler result: `{ videoKey: string; videoUrl: string; mimeType: string; input1Name: string; input2Name: string }`.

- [ ] **Step 1: Write failing handler tests**

Test rejection of missing keys, provider configuration without a ComfyUI base URL, ordered source URLs passed to the client, output MP4 upload under the authenticated user’s output prefix, and the returned stable application URL.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx.cmd vitest run tests/unit/worker/video-seam-concat.test.ts`

Expected: missing task type and handler module failures.

- [ ] **Step 3: Implement task routing and handler**

Resolve both storage URLs with `getSignedObjectUrl`, call the client, decode base64, upload the output with `video/mp4`, report received/uploading/processing/persisting stages through `reportTaskProgress`, and return the persisted result. Add the type to all exhaustive task maps and queue routing.

- [ ] **Step 4: Run tests and task guards**

Run: `npx.cmd vitest run tests/unit/worker/video-seam-concat.test.ts`

Run: `npm.cmd run check:test-tasktype-coverage`

Expected: handler tests and task-type guard pass.

- [ ] **Step 5: Commit**

Run: `git add src/lib/task src/lib/workers tests/unit/worker scripts/guards && git commit -m "feat: execute video seam concat tasks"`

### Task 5: Build the standalone video-tools page

**Files:**
- Create: `src/app/[locale]/workspace/video-tools/page.tsx`
- Create: `src/app/[locale]/workspace/video-tools/VideoUploadCard.tsx`
- Create: `src/app/[locale]/workspace/video-tools/video-tools-state.ts`
- Modify: `src/components/Navbar.tsx`
- Modify: `src/components/ui/icons.tsx` only if no existing video/tool icon is suitable.
- Modify: `src/i18n.ts`
- Modify: `messages/zh/nav.json`
- Modify: `messages/en/nav.json`
- Create: `messages/zh/videoTools.json`
- Create: `messages/en/videoTools.json`
- Test: `tests/unit/video-tools/video-tools-state.test.ts`

**Interfaces:**
- `UploadedVideo`: `{ key: string; url: string; name: string; size: number; mimeType: string }`.
- `resolveVideoToolTaskView(task)` maps queued/processing/completed/failed task JSON into one page presentation state.
- Page APIs: `POST /api/video-tools/uploads`, `POST /api/video-tools/seam-concat`, and `GET /api/tasks?projectId=video-tools&type=video_seam_concat&limit=5`.

- [ ] **Step 1: Write failing state tests**

Cover button enablement only with two uploads, active-task lockout, queued/processing labels, completed result extraction, failed retry preservation, and newest-active-task selection from recent tasks.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx.cmd vitest run tests/unit/video-tools/video-tools-state.test.ts`

Expected: missing state module failure.

- [ ] **Step 3: Implement state helpers and page**

Build two upload cards with native video previews and object URL cleanup, submit both keys, poll only while a standalone task is active, show the large result player and download link, preserve inputs after failures, and render five recent runs. Add the navigation entry and bilingual messages.

- [ ] **Step 4: Run tests, locale guard, and typecheck**

Run: `npx.cmd vitest run tests/unit/video-tools/video-tools-state.test.ts`

Run: `npm.cmd run check:locale-navigation`

Run: `npm.cmd run typecheck`

Expected: tests, navigation guard, and TypeScript pass.

- [ ] **Step 5: Commit**

Run: `git add src/app/[locale]/workspace/video-tools src/components/Navbar.tsx src/i18n.ts messages tests/unit/video-tools && git commit -m "feat: add video seam concat workspace"`

### Task 6: Verify regression and real workflow output

**Files:**
- Modify only if a failing verification exposes a tested defect.

**Interfaces:**
- Input 1: `C:\work\tool\蛊真人后续\video片段\shot-1-video.mp4`.
- Input 2: `C:\work\tool\蛊真人后续\video片段\shot-2-video.mp4`.

- [ ] **Step 1: Run the focused automated suite**

Run: `npx.cmd vitest run tests/unit/providers/comfyui-workflow-registry.test.ts tests/unit/providers/comfyui-client.test.ts tests/unit/video-tools tests/unit/worker/video-seam-concat.test.ts tests/integration/api/contract/video-tools-routes.test.ts`

Expected: all focused tests pass without warnings.

- [ ] **Step 2: Run static and guard verification**

Run: `npm.cmd run typecheck`

Run: `npm.cmd run check:api-handler`

Run: `npm.cmd run check:test-tasktype-coverage`

Run: `npm.cmd run check:locale-navigation`

Expected: every command exits 0.

- [ ] **Step 3: Start the full stack and perform a browser run**

Run: `C:\work\workspace\start-waoowaoo-dev.bat`

Open `/zh/workspace/video-tools`, upload the two specified files in order, click “开始拼接”, wait for the task to complete, play the result, and use the download action.

Expected: the page progresses through upload, queue, processing, and completed states; the output is playable and survives a page refresh.

- [ ] **Step 4: Validate media continuity**

Inspect the generated MP4 metadata with the available browser media element or ComfyUI output metadata. Confirm its duration equals Video 1 duration plus Video 2 duration minus one Video 2 frame within one-frame tolerance, and confirm the output audio continues across the seam.

- [ ] **Step 5: Review diff and commit verification fixes**

Run: `git status --short && git diff --check && git log -6 --oneline`

If verification required tested corrections, commit them with `git commit -m "fix: complete video seam concat verification"`. Otherwise leave the verified feature commits unchanged.
