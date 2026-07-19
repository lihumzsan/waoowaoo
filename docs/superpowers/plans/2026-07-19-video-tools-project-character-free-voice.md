# Video Tools Project Character Free Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make video-tools free voice require a user-owned project and use the selected project character's reference audio.

**Architecture:** Reuse the existing projects list and unified project-assets query on the client. Change the transient free-voice submission contract to carry `projectId` and `characterId`; resolve and authorize the project character on the server, snapshot its display data into Redis, and enqueue the transient job against the real project ID.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, Prisma, Redis, BullMQ, Vitest, next-intl.

## Global Constraints

- Project characters are the only selectable reference-audio source; do not fall back to global voices.
- Characters without reference audio remain visible but disabled and show an explicit suffix.
- Changing the project clears the selected character.
- Do not add configuration links, automatic repair, preview controls, project search, character search, or new dependencies.
- Free-voice records and audio remain Redis-only with a TTL of exactly `86_400` seconds.
- No Prisma schema or migration changes.
- Do not modify the video seam-concat tool.

## Business Scope / Out of Scope

In scope: project selection, project-character selection, disabled missing-voice options, submission authorization, project audio-model resolution, real project task attribution, source snapshots in transient results, localized labels, automated regression coverage, and browser acceptance.

Out of scope: global voice selection, changing character voice configuration, database history, versions, search, preview, shortcuts, auto-navigation, and seam-concat changes.

## File Structure

- Modify `src/app/[locale]/workspace/video-tools/FreeVoiceToolCard.tsx`: project/character data loading, dependent selection state, request body, and source display.
- Modify `src/app/api/video-tools/free-voice/route.ts`: validate and pass `projectId` plus `characterId`.
- Modify `src/lib/video-tools/free-voice.ts`: authorize the project character, resolve the project audio model, snapshot project/character metadata, and enqueue using the real project ID.
- Create `src/app/[locale]/workspace/video-tools/free-voice-tool-state.ts`: pure request and character-option derivation used by the card and unit tests.
- Modify `messages/zh/videoTools.json` and `messages/en/videoTools.json`: project/character copy and loading/empty/error states.
- Modify `tests/integration/api/contract/video-tools-routes.test.ts`: route request-contract regression coverage.
- Create `tests/unit/video-tools/free-voice-project-source.test.ts`: service authorization and queue-payload coverage.
- Create `tests/unit/video-tools/free-voice-tool-state.test.ts`: project-character option and request-body coverage plus a narrow source contract for project-change reset.
- Update this plan's `Delivery Record`: actual changes, verification, deviations, and remaining risks.

---

### Task 1: Enforce the project-character server contract

**Files:**
- Create: `tests/unit/video-tools/free-voice-project-source.test.ts`
- Modify: `src/lib/video-tools/free-voice.ts`

**Interfaces:**
- Consumes: `createVideoToolFreeVoiceTask({ userId, locale, requestId, text, projectId, characterId })`.
- Produces: a `VideoToolFreeVoiceRecord` with optional compatibility fields `projectId`, `projectName`, `characterId`, and `characterName`; a transient `TaskJobData` whose `projectId` is the real project ID.

- [x] **Step 1: Write the failing service tests**

Add tests that mock Prisma, model resolution, Redis, and the queue. The success case must assert the lookup and payload:

```ts
const result = await createVideoToolFreeVoiceTask({
  userId: 'user-1', locale: 'zh', text: 'hello',
  projectId: 'project-1', characterId: 'character-1',
})

expect(projectFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: 'project-1', userId: 'user-1' },
}))
expect(characterFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: 'character-1', novelPromotionProjectId: 'novel-1' },
}))
expect(addTaskJobMock).toHaveBeenCalledWith(expect.objectContaining({
  projectId: 'project-1',
  payload: expect.objectContaining({ referenceAudioUrl: '/voice/hero.wav' }),
}), expect.any(Object))
expect(result.record).toMatchObject({
  projectId: 'project-1', projectName: 'Project One',
  characterId: 'character-1', characterName: 'Hero', voiceName: 'Hero',
})
```

Add isolated failures for an unowned/missing project, a character outside the selected project, and a character without `customVoiceUrl`; each must reject before `addTaskJob` runs.

- [x] **Step 2: Run the service test and verify RED**

Run: `npx vitest run tests/unit/video-tools/free-voice-project-source.test.ts`

Expected: FAIL because `createVideoToolFreeVoiceTask` still accepts `voiceSourceId` and queries `globalVoice`.

- [x] **Step 3: Implement the minimal server-side source resolution**

Change the input and lookup flow to:

```ts
const project = await prisma.project.findFirst({
  where: { id: params.projectId.trim(), userId: params.userId },
  select: {
    id: true,
    name: true,
    novelPromotionData: { select: { id: true, audioModel: true } },
  },
})
if (!project?.novelPromotionData) throw new ApiError('NOT_FOUND')

const character = await prisma.novelPromotionCharacter.findFirst({
  where: {
    id: params.characterId.trim(),
    novelPromotionProjectId: project.novelPromotionData.id,
  },
  select: { id: true, name: true, customVoiceUrl: true },
})
if (!character) throw new ApiError('NOT_FOUND')
if (!character.customVoiceUrl) {
  throw new ApiError('INVALID_PARAMS', { message: 'FREE_VOICE_REFERENCE_AUDIO_REQUIRED' })
}
```

Pass `project.novelPromotionData.audioModel` to model selection, write project/character snapshot fields to Redis, use `character.customVoiceUrl` in the job payload, and set `jobData.projectId = project.id`. Keep the existing TTL and transient persistence unchanged.

- [x] **Step 4: Run the service and Redis tests and verify GREEN**

Run: `npx vitest run tests/unit/video-tools/free-voice-project-source.test.ts tests/unit/video-tools/free-voice-redis.test.ts tests/unit/worker/voice-worker.test.ts`

Expected: all selected tests pass with zero failures.

- [x] **Step 5: Commit the server behavior**

```bash
git add src/lib/video-tools/free-voice.ts tests/unit/video-tools/free-voice-project-source.test.ts
git commit -m "fix(video-tools): use project character voice source"
```

### Task 2: Change the API request contract

**Files:**
- Modify: `tests/integration/api/contract/video-tools-routes.test.ts`
- Modify: `src/app/api/video-tools/free-voice/route.ts`

**Interfaces:**
- Consumes: authenticated JSON `{ text: string, projectId: string, characterId: string }`.
- Produces: the existing async response containing `record` and `taskId`.

- [x] **Step 1: Write failing route-contract tests**

Replace the old `voiceSourceId` fixture with:

```ts
body: {
  text: 'hello',
  projectId: 'project-1',
  characterId: 'character-1',
}
```

Assert `createVideoToolFreeVoiceTaskMock` receives both IDs. Add table-driven missing-field cases for `projectId` and `characterId`, expecting HTTP 400 and no service call.

- [x] **Step 2: Run the route test and verify RED**

Run: `npx vitest run tests/integration/api/contract/video-tools-routes.test.ts`

Expected: FAIL because the route still reads `voiceSourceId`.

- [x] **Step 3: Implement the route input mapping**

Read trimmed strings for `text`, `projectId`, and `characterId`; reject when any are empty; call:

```ts
await createVideoToolFreeVoiceTask({
  userId: auth.session.user.id,
  locale: resolveRequiredTaskLocale(request, body),
  requestId: getRequestId(request),
  text,
  projectId,
  characterId,
})
```

- [x] **Step 4: Run the contract test and verify GREEN**

Run: `npx vitest run tests/integration/api/contract/video-tools-routes.test.ts`

Expected: all video-tools route tests pass.

- [x] **Step 5: Commit the API contract**

```bash
git add src/app/api/video-tools/free-voice/route.ts tests/integration/api/contract/video-tools-routes.test.ts
git commit -m "fix(video-tools): require project character for free voice"
```

### Task 3: Deliver the dependent project and character selectors

**Files:**
- Create: `src/app/[locale]/workspace/video-tools/free-voice-tool-state.ts`
- Create: `tests/unit/video-tools/free-voice-tool-state.test.ts`
- Modify: `src/app/[locale]/workspace/video-tools/FreeVoiceToolCard.tsx`
- Modify: `messages/zh/videoTools.json`
- Modify: `messages/en/videoTools.json`

**Interfaces:**
- Consumes: `GET /api/projects?page=1&pageSize=1000`, `useProjectCharacters(projectId)`, and the new free-voice POST contract.
- Produces: project select, dependent character select, disabled missing-voice options, and source-labelled result cards.

- [x] **Step 1: Write failing client-state regression tests**

Test pure option and request derivation without adding a DOM-testing dependency:

```ts
expect(buildProjectCharacterOptions([
  { id: 'character-1', name: 'Hero', customVoiceUrl: '/voice/hero.wav' },
  { id: 'character-2', name: 'Silent', customVoiceUrl: null },
], 'missingReference')).toEqual([
  { id: 'character-1', label: 'Hero', disabled: false },
  { id: 'character-2', label: 'Silent (missingReference)', disabled: true },
])
```

Assert request construction returns:

```ts
expect(buildFreeVoiceSubmitInput({
  text: ' hello ', projectId: 'project-1', characterId: 'character-1',
  characterHasReference: true,
})).toEqual({ text: 'hello', projectId: 'project-1', characterId: 'character-1' })
```

Add invalid cases for missing text, project, character, or reference audio. Read the component source and assert it imports `useProjectCharacters`, does not import `useGlobalVoices`, and clears `characterId` in the project change handler.

- [x] **Step 2: Run the component test and verify RED**

Run: `npx vitest run tests/unit/video-tools/free-voice-tool-state.test.ts`

Expected: FAIL because the state module does not exist and the current component uses the global-voice hook.

- [x] **Step 3: Implement the client data and selection flow**

Implement `buildProjectCharacterOptions` and `buildFreeVoiceSubmitInput`, then replace `useGlobalVoices` with `useProjectCharacters`. Load project options once through the existing projects endpoint. Maintain `projectId` and `characterId`; on project change run:

```ts
setProjectId(event.target.value)
setCharacterId('')
```

Render project and character selects in a responsive two-column grid. Character options use `disabled={!character.customVoiceUrl}` and append the localized missing-reference suffix. Submit `text`, `projectId`, and `characterId`. Result cards display `projectName · characterName` when both snapshots exist, otherwise retain `voiceName` for old Redis records.

- [x] **Step 4: Add matching Chinese and English messages**

Add the same keys to both locales: `project`, `selectProject`, `loadingProjects`, `emptyProjects`, `character`, `selectProjectFirst`, `selectCharacter`, `loadingCharacters`, `emptyCharacters`, `missingReference`, and `errors.loadProjectsFailed`. Update the description to say that a project and its character reference voice are required.

- [x] **Step 5: Run component and message checks and verify GREEN**

Run: `npx vitest run tests/unit/video-tools/free-voice-tool-state.test.ts tests/unit/video-tools/video-tools-page.test.ts`

Run: `node -e "const fs=require('node:fs'); const zh=JSON.parse(fs.readFileSync('messages/zh/videoTools.json','utf8')); const en=JSON.parse(fs.readFileSync('messages/en/videoTools.json','utf8')); const keys=['project','selectProject','loadingProjects','emptyProjects','character','selectProjectFirst','selectCharacter','loadingCharacters','emptyCharacters','missingReference']; for (const key of keys) { if (!(key in zh.freeVoice) || !(key in en.freeVoice)) process.exit(1) }"`

Expected: both commands exit zero.

- [x] **Step 6: Commit the frontend behavior**

```bash
git add src/app/[locale]/workspace/video-tools/FreeVoiceToolCard.tsx src/app/[locale]/workspace/video-tools/free-voice-tool-state.ts messages/zh/videoTools.json messages/en/videoTools.json tests/unit/video-tools/free-voice-tool-state.test.ts
git commit -m "fix(video-tools): select project character reference voice"
```

### Task 4: Verify the complete slice and record delivery evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-video-tools-project-character-free-voice.md`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: fresh automated and browser evidence plus an updated delivery record.

- [x] **Step 1: Run focused and repository checks**

Run:

```bash
npx vitest run \
  tests/unit/video-tools/free-voice-project-source.test.ts \
  tests/unit/video-tools/free-voice-redis.test.ts \
  tests/unit/video-tools/free-voice-tool-state.test.ts \
  tests/unit/video-tools/video-tools-page.test.ts \
  tests/unit/worker/voice-worker.test.ts \
  tests/integration/api/contract/video-tools-routes.test.ts
npm run lint -- 'src/app/[locale]/workspace/video-tools/FreeVoiceToolCard.tsx' 'src/app/[locale]/workspace/video-tools/free-voice-tool-state.ts' 'src/app/api/video-tools/free-voice/route.ts' 'src/lib/video-tools/free-voice.ts'
npm run typecheck
git diff --check HEAD~3..HEAD
```

Expected: focused tests and lint pass. Typecheck must be reported from its actual output; pre-existing unrelated failures may be triaged but not hidden.

- [ ] **Step 2: Run real-browser functional and visual acceptance**

Open `/zh/workspace/video-tools` in the authenticated local app. Capture:

- Desktop screenshot around `1536x960` with a selected project and the character list open or visibly populated.
- Mobile-sized screenshot around `390x844` with the dependent selectors stacked.

Verify project switching clears the role, missing-reference roles are disabled and labelled, a configured role enables generation when text is present, controls share coherent heights and baselines, and there is no horizontal overflow.

- [x] **Step 3: Update Delivery Record with exact evidence**

Record commands, pass/fail counts, screenshot paths, viewport/route/state, actual implementation, deviations, risks, and follow-ups in this file.

- [x] **Step 4: Commit delivery evidence**

```bash
git add docs/superpowers/plans/2026-07-19-video-tools-project-character-free-voice.md
git commit -m "docs: record project free voice verification"
```

## Acceptance Mapping

| Acceptance criterion | Implementation | Evidence |
| --- | --- | --- |
| User must select a project before a character | Task 3 dependent selectors | Client-state/source test and browser interaction |
| Characters come only from the selected project | `useProjectCharacters(projectId)` plus server ownership lookup | Client-state/source test and service test |
| Missing-reference characters stay visible but disabled | Character option state | Client-state test; authenticated browser data had no missing-reference character to capture |
| Cross-project and unowned sources are rejected | Project and character Prisma constraints | Service failure tests |
| Generation uses the project model and real project attribution | Service model resolution and `TaskJobData.projectId` | Queue-payload assertion |
| Results identify project and character | Redis snapshot and result heading | Service test; the authenticated Redis list was empty and no live generation was submitted during acceptance |
| Transient one-day behavior remains intact | Existing Redis storage path | Redis TTL regression test |
| Layout remains aligned and responsive | Responsive grid using existing glass tokens | Desktop and mobile screenshots |

## Risks, Rollback and Observation

- Risk: project lists over 1,000 entries are not represented because the existing paginated endpoint is intentionally reused without adding search. Observe project selector completeness for unusually large accounts.
- Risk: an old Redis record lacks project/character snapshots. Compatibility display falls back to its existing `voiceName`.
- Risk: a role's reference audio can be removed after the page loads. The server revalidates at submission and fails before queueing.
- Rollback: revert the three implementation commits; no database rollback is required because no schema or persistent data changes are introduced.
- Observe: free-voice submission 4xx rate and worker failures mentioning `FREE_VOICE_REFERENCE_AUDIO_REQUIRED` after release.

## Delivery Metadata

- Plan Path: `docs/superpowers/plans/2026-07-19-video-tools-project-character-free-voice.md`
- Plan Status: implementation complete; verification recorded with one browser-data gap
- Evidence Profile: standard
- Story ID: not requested
- Task IDs: not requested; Superpowers Tasks 1-4 map to one user-visible bug-fix slice
- ZenTao Sync Status: not-synced because the user did not request ZenTao operations
- ZenTao Readback Evidence / Time: not applicable
- Last Updated: 2026-07-19

## Delivery Record

### Actual Implementation

The free-voice server contract now requires `projectId` and `characterId`, authorizes the user-owned project and a character belonging to that project's novel-promotion data, rejects missing reference audio before queueing, resolves the project's audio model, snapshots project and character identity into the transient Redis record, and attributes the queued task to the real project ID. The Redis-only `86_400`-second TTL remains unchanged.

The API route trims and validates `text`, `projectId`, and `characterId`. The client now loads the existing project list, loads characters only for the selected project, clears the selected character when the project changes, keeps missing-reference characters visible but disabled with localized copy, submits the new request shape, and displays `projectName · characterName` for new result snapshots with the existing `voiceName` fallback for older records.

### Plan Deviations

There was no production implementation deviation. Browser acceptance could not exercise the missing-reference option because the two projects available to the authenticated account contained 19 characters in total and every rendered character option had reference audio. No user data was created or modified to manufacture that state.

No live generation was submitted during browser acceptance, so the empty authenticated result panel did not provide a live result-card identity screenshot. Project/character result attribution remains covered by the service and Redis assertions.

### Impact

Impact is limited to the video-tools free-voice UI, its POST contract, transient project-character source resolution, localized copy, and focused tests. No schema, migration, persistent free-voice history, dependency, or seam-concat change was introduced.

### Verification

Fresh automated verification on 2026-07-19:

- `npx vitest run tests/unit/video-tools/free-voice-project-source.test.ts tests/unit/video-tools/free-voice-redis.test.ts tests/unit/video-tools/free-voice-tool-state.test.ts tests/unit/video-tools/video-tools-page.test.ts tests/unit/worker/voice-worker.test.ts tests/integration/api/contract/video-tools-routes.test.ts` exited `0`: 6 test files passed, 38 tests passed, 0 failed, duration 1.72 seconds. The route suite's expected rejection cases emitted error logs while their assertions passed.
- `npm run lint -- 'src/app/[locale]/workspace/video-tools/FreeVoiceToolCard.tsx' 'src/app/[locale]/workspace/video-tools/free-voice-tool-state.ts' 'src/app/api/video-tools/free-voice/route.ts' 'src/lib/video-tools/free-voice.ts'` exited `0`: 0 errors and 2 `react-hooks/exhaustive-deps` warnings at `FreeVoiceToolCard.tsx:57` about the `characters` fallback expression used by the two `useMemo` dependency lists.
- `npm run typecheck` exited `0` with no TypeScript diagnostics.
- `git diff --check HEAD~3..HEAD` exited `0` with no output.

Authenticated real-browser acceptance used the checkout-owned local app at `http://localhost:3000/zh/workspace/video-tools`; the existing Next.js listener on port 3000 belonged to this checkout, rendered the committed UI, and did not require a restart. A new-page load completed with no browser warning or error logs.

- Initial state: the character selector was disabled with `请先选择项目` until a project was selected.
- Project-scoped population: selecting `蛊真人后传` exposed 13 characters; selecting `mountain` exposed 6. No global voice list was present.
- Reset interaction: after selecting `蛊真人后传 · 方源`, switching to `mountain` immediately reset the character value to empty, showed the loading state, and left generation disabled.
- Enabled interaction: selecting `mountain · 陈迹` with text `浏览器验收测试文本` enabled `生成自由配音`; no generation was submitted.
- Missing-reference state: all 19 authenticated character options were enabled, so the real account did not supply a missing-reference role. The disabled-and-suffixed behavior passed the focused client-state test but remains unproven by a live screenshot.
- Desktop CSS viewport `1536x960`: the project and character selects were each 43.75 px high with identical 363.70 px center lines; the document and free-voice card both reported no horizontal overflow (`1215 == 1215` card client/scroll width). Screenshot: `/Users/tigli/workspace/work/github/waoowaoo/.superpowers/sdd/evidence/task-4-free-voice-desktop-1536x960.png` (raw PNG 1920x1200 because the browser session used a 0.8 device scale/zoom).
- Mobile CSS viewport `390x844`: project and character fields stacked vertically; both selects measured 316.76x43.75 px, the generate button remained inside the card, and document/card overflow checks both passed (`390 == 390` document width and `357 == 357` card width). Screenshot: `/Users/tigli/workspace/work/github/waoowaoo/.superpowers/sdd/evidence/task-4-free-voice-mobile-390x844.png` (raw PNG 488x1054 at the same browser scale).
- Screenshot review: control outer boxes and selected text were visually centered and coherent on desktop and mobile; the mobile reading order was continuous, with no clipped selector or horizontal scroll. The Next.js development toolbar visible near the screenshot bottom is a development-only overlay, not application content.

### Remaining Risks

The release risks listed above remain applicable. Browser acceptance still needs authenticated data containing at least one character without `customVoiceUrl` to prove the disabled `(缺少参考音频)` option visually. A disposable live generation would also be required if live result-card identity evidence is mandatory rather than the existing service/Redis assertions.

Focused lint passes but retains the two `react-hooks/exhaustive-deps` warnings described above; they did not affect this acceptance run.

### Follow-ups

Provide or identify an authenticated project containing a missing-reference character, then repeat the desktop capture without changing production code. If live result rendering must also be proven, authorize one disposable free-voice generation and capture the resulting `projectName · characterName` card.

### ZenTao Closeout

No ZenTao operation was requested or performed.
