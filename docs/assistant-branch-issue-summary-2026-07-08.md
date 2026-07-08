# Assistant Branch Issue Summary

Branch: `codex/colleague-exp-assistant-latest`

Base branch reviewed: `origin/exp/assistant`

Date range: July 7, 2026 to July 8, 2026

## Current Status

The edit-first workflow is currently paused at `ready_to_generate_videos`.

Completed:

- Project creation and workspace navigation
- Episode bible generation and confirmation
- Visual style selection
- Core edit script planning
- Required asset generation and review
- Shot execution plan generation for all 6 chapters
- Storyboard panel generation for all 6 chapters
- Storyboard image generation for all 125 panels

Not started:

- Video segment generation

The current blocker is intentional: the UI is waiting for the user to confirm the production budget before `generate_episode_videos` submits video tasks.

## Commit Message Audit

The local commits added on top of `origin/exp/assistant` were reviewed before push. Each bug-fix commit describes the failure cause, the fix, and the validation result in its commit body. A few earlier commit bodies contain literal escaped newline sequences from shell quoting, but the cause/fix/validation content is present and readable, so the history was not rewritten.

## Issues And Fixes

### 1. Project Creation Failed With `userId` Foreign Key Error

Symptom:

- The home quick-start flow failed after the user entered a story idea.
- The UI exposed a Prisma foreign key error on `userId`.
- A later attempt surfaced `Unauthorized`.

Root cause:

- The authenticated session could outlive or diverge from the canonical database user row.
- Routes accepted the session identity too early, so project creation reached the database with a user id that did not exist.

Fix:

- User auth guards now resolve the session through a canonical database user before returning an authenticated context.
- Stale JWT users are normalized to database users by the signed-in login name when possible.
- Unresolvable sessions fail explicitly with 401 instead of reaching writes.
- Home quick-start navigation now passes a concrete string URL to the i18n router after project creation.

Key commits:

- `82d78f3f Validate session user before user writes`
- `818f6dad Normalize stale auth sessions to database users`
- `3a1ff9a2 Use string target for home quick-start navigation`

### 2. Edit Bible Source Range Validation Failed Late

Symptom:

- Bible generation failed after intermediate structured outputs had already been produced.
- The user only saw a generic script blueprint failure.

Root cause:

- Several edit bible extraction steps validated JSON shape but did not validate `sourceStart` and `sourceEnd` against the source document length at the step boundary.
- Out-of-range offsets only surfaced during final package persistence.

Fix:

- Shared source range cross-checking was added to the relevant extraction steps.
- Prompt templates now include the source length and explicitly define the valid offset range.

Key commit:

- `222977fb Fix edit bible source range validation`

### 3. Asset Generation Claimed Progress Without Real Tasks

Symptom:

- The assistant sometimes claimed assets were submitted or being monitored while no queued or processing task existed.
- The workflow stayed blocked on required assets.

Root cause:

- `generate_edit_script_assets` could return success with no task ids after all possible asset work was already submitted or complete.
- The operation did not distinguish a true no-op from a stalled state where requirements still remained incomplete.
- The assistant prompt did not forbid describing no-op results as background work.

Fix:

- Asset generation output now exposes `noop`, processed requirement counts, and remaining requirement counts.
- Empty results with remaining incomplete requirements fail explicitly as `EDIT_SCRIPT_ASSET_GENERATION_STALLED`.
- Project-agent copy now tells the model not to describe no-op results as submitted background tasks.

Key commits:

- `ff8f6c32 Fix asset generation noop signal`
- `0ece3f09 Prevent noop task progress hallucination`
- `0fcfb2fb Fix episode-scoped edit asset generation`
- `1c99689a Guard edit asset generation stalls`
- `9b62d086 Fix asset-stage storyboard prompt loop`

### 4. Asset Review Approved Only One Chapter

Symptom:

- After the user approved assets, the workflow still stayed in `assets_ready_for_review`.
- Storyboard and shot execution tools were not made available.

Root cause:

- Asset review is an episode-level decision in this flow.
- The service fell back to the default chapter when no `chapterId` was passed, so only one chapter's `ProjectEditScript.assetReviewStatus` was updated.
- Workflow aggregation across all 6 chapters still saw pending scripts.

Fix:

- Episode-scoped asset approval now reads all edit scripts in the episode and approves all of them after verifying their requirements are complete.
- Explicit chapter-scoped calls still approve only that chapter.

Key commit:

- `ec7aa8c3 Fix episode asset review progression`

### 5. Workspace Runtime Crashed On Off-Screen Stream Patch

Symptom:

- The browser showed a runtime error:
  `WORKSPACE_STREAM_PATCH_WITHOUT_CANONICAL_NODE`

Root cause:

- Batch shot plan generation emitted structured stream patches for multiple chapter nodes.
- The current canvas projection only included the current scope's canonical nodes.
- A patch for an off-screen chapter had no canonical node in the current projection, and the frontend threw instead of preserving the runtime patch state.

Fix:

- Structured stream patch merging now leaves `baseNodes` unchanged when the patch targets a node outside the current projection.
- The patch remains available for later application when the corresponding canonical node is present.

Key commit:

- `fe2d6f07 Fix off-screen stream patch crash`

### 6. Shot Execution Plan Only Submitted One Chapter

Symptom:

- The assistant promised project-level shot execution planning, but only one chapter was submitted.
- Remaining chapters stayed missing and the assistant looped.

Root cause:

- `generate_edit_shot_execution_plan` defaulted to a single edit script when no chapter scope was provided.
- Assistant-panel context could also carry a stale current `editScriptId`, bypassing the intended episode batch path.

Fix:

- Episode-scoped batch submission was added for all ready edit scripts without a ready shot execution plan.
- Assistant-panel calls force the episode batch path unless an explicit non-assistant scoped call is made.
- Batch submissions emit `data-task-batch-submitted` and compensate already submitted tasks if a later target fails.

Key commits:

- `bc0d611a Fix edit shot execution plan batch submission`
- `8f3d094c Fix assistant shot plan scope and schema guidance`

### 7. Completed Shot Plan Operations Consumed Retry Budget

Symptom:

- A valid retry was blocked as `OPERATION_NOT_ALLOWED` even after previous operation activity had completed successfully.

Root cause:

- Run budget accounting counted all same-operation, same-target starts, including operations that had already completed successfully.

Fix:

- Run budget now tracks unresolved attempts by activity id and releases them when `activity.completed` arrives.
- Failed or anonymous attempts still count toward loop protection.

Key commit:

- `3a4fe71e Fix agent retry budget for completed operations`

### 8. Shot Execution Plan Resubmitted Ready Targets

Symptom:

- The assistant kept submitting a single shot execution plan task for a chapter that was already ready.
- Other missing chapters stayed blocked.

Root cause:

- The shared single-task submission path did not check authoritative `ProjectEditShotExecutionPlan` readiness before enqueueing.

Fix:

- Single-target submission now fails explicitly if the target already has a ready shot execution plan.
- Episode batch submission still selects only missing or failed plans.

Key commit:

- `70075a86 Fix shot execution plan resubmission loop`

### 9. Sixth Chapter Shot Execution Plan Failed Schema Validation

Symptom:

- Chapter 6 repeatedly failed with model output schema errors.

Root cause:

- The model copied input-only field names into output:
  - `generationSegmentExecutions[].continuity` instead of `continuousVideoPrompt`
  - `role` inside blocking character/object records
- Strict schema validation rejected those outputs before persistence.

Fix:

- The prompt now receives a conflict-free `videoGenerationSegments[].continuityReference` input shape.
- The single authoritative normalizer converts known copied input-only fields:
  - `continuity` becomes `continuousVideoPrompt`
  - copied `role` fields are removed from blocking records
- Unknown schema deviations still fail explicitly.

Key commit:

- `ca538d0f Fix shot execution plan field normalization`

### 10. Storyboard Panel Creation Failed On Local `clipId` Constraint

Symptom:

- Storyboard panel generation failed with:
  `Null constraint violation on the fields: (clipId)`

Root cause:

- The local preview database still had an old `project_storyboards.clipId NOT NULL` column.
- Current Prisma schema no longer requires or writes `clipId`.
- The local migration table did not include the migration that removed or relaxed this column.

Fix:

- The local preview database was inspected and repaired by making `project_storyboards.clipId` nullable.
- The 6 storyboard panel tasks were then resubmitted.

Result:

- All 6 storyboard records were created.
- 125 storyboard panel rows were created.

Code impact:

- No repository code change was required for this local database repair.

### 11. Storyboard Image Generation Did Not Start

Symptom:

- The user requested storyboard image generation.
- The UI appeared idle.
- No `generate_edit_script_storyboard_images` tasks existed.
- The latest project-agent run was cancelled as `stale_running_run`.

Root cause:

- Project-agent runs created a running database record before entering the Agents SDK.
- The heartbeat was started only after the streamed run object returned.
- If model stream bootstrap blocked or was slow, the run had no fresh heartbeat and was cancelled as stale before any operation activity could submit image tasks.

Fix:

- The project-agent heartbeat now starts immediately before entering the Agents SDK `run(...)` call.
- Existing stop and lock release lifecycle remains unchanged for stream completion, failure, and cancellation.

Key commit:

- `59e74a16 Fix project agent stale bootstrap heartbeat`

### 12. Storyboard Image Count Was 125

Symptom:

- The generated storyboard image count looked too high.

Root cause:

- This is the current workflow design, not a failure.
- The system generates one storyboard panel per shot and one image per panel.
- The 6 chapter shot counts were:
  - Chapter 1: 24
  - Chapter 2: 22
  - Chapter 3: 17
  - Chapter 4: 20
  - Chapter 5: 18
  - Chapter 6: 24
- Total: `24 + 22 + 17 + 20 + 18 + 24 = 125`

Design note:

- If this is too expensive or too detailed, the right fix is to reduce shot granularity during core edit planning or shot execution planning. The image generation step should not silently drop panels after the storyboard has already been planned.

### 13. Localhost Became Unreachable

Symptom:

- Browser showed:
  `ERR_CONNECTION_REFUSED`

Root cause:

- The local Next dev server on `localhost:3001` was no longer reachable.

Fix:

- Restarted the local development stack with `PORT=3001 npm run dev`.
- Confirmed `http://localhost:3001` returned HTTP 200.
- Reverted the unrelated `tsconfig.json` change that Next dev auto-added during startup.

Code impact:

- No repository code change was required for this environment issue.

## Verification Summary

Targeted tests and checks used across the fixes included:

- `npx vitest run tests/unit/helpers/api-auth.require-project-auth.test.ts`
- `npx vitest run tests/unit/home/create-project-launch.test.ts tests/unit/home/quick-start-submit.test.ts`
- `npx vitest run tests/unit/edit-bible/extraction.test.ts tests/unit/ai-prompts/registry.test.ts tests/unit/ai-prompts/prompt-blocks.test.ts tests/unit/worker/edit-bible-generate.test.ts`
- `npx vitest run tests/regression/edit-script/asset-generation-scope.test.ts`
- `npx vitest run tests/unit/project-workflow/edit-first.test.ts`
- `npx vitest run tests/unit/project-workspace/structured-stream-runtime.test.ts tests/unit/project-workspace/structured-stream-adapters.test.ts`
- `npx vitest run tests/unit/edit-script/task-submission.test.ts`
- `npx vitest run tests/unit/operations/edit-shot-execution-plan-operation.test.ts`
- `npx vitest run tests/unit/project-agent/run-budget.test.ts`
- `npx vitest run tests/unit/edit-script/normalize.test.ts tests/unit/edit-script/shot-execution-plan-prompt.test.ts`
- `npx vitest run tests/unit/project-agent/runtime-routing.test.ts`
- Targeted `npx eslint` runs for each changed source/test set

Known validation caveat:

- `npm run typecheck` was attempted earlier and remained blocked by pre-existing `.next-verify/types/validator.ts` missing route modules and `tmp/*` script errors. These were not introduced by the branch fixes listed here.

## Current Next Step

The current UI prompt is correct. To continue production, the user must explicitly confirm the video generation budget. Until that confirmation happens, no video generation tasks should run.
