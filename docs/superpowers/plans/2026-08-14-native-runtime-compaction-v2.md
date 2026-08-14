# Native Runtime Compaction V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long workspace-assistant conversations compact through the supported native Codex v2 path, unblock the existing retrying media Task, and prove recovery from the workspace UI.

**Architecture:** Keep `ASSISTANT_RUNTIME_STATIC_CONTRACT` as the only feature authority. Change only its compaction declaration, exercise it with a direct production-contract test, and use the existing new-Turn continuation flow for recovery.

**Tech Stack:** TypeScript, Vitest, Next.js, Codex App Server, Prisma, in-app browser.

## Global Constraints

- Do not modify or replay persistent media tasks; let the existing Temporal Workflow resume through its authored retry path.
- Do not add a compatibility fallback or a second runtime configuration source.
- Keep the previous SSE repair on its separate branch.
- UI verification must originate from the “继续未完成任务” button.

---

### Task 1: Pin the native compaction contract

**Files:**
- Modify: `src/lib/assistant-runtime/runtime-access.ts`
- Create: `tests/unit/assistant-runtime/runtime-access-contract.test.ts`

**Interfaces:**
- Consumes: `ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.remoteCompactionV2`
- Produces: a native runtime contract where `remoteCompactionV2` is always `true`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { ASSISTANT_RUNTIME_STATIC_CONTRACT } from '@/lib/assistant-runtime/runtime-access'

describe('assistant native runtime contract', () => {
  it('uses the supported v2 remote compaction protocol', () => {
    expect(ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.remoteCompactionV2).toBe(true)
  })
})
```

- [ ] **Step 2: Verify RED**

Run: `vitest run tests/unit/assistant-runtime/runtime-access-contract.test.ts`

Expected: FAIL because the current production contract returns `false`.

- [ ] **Step 3: Apply the minimal production change**

Change the contract declaration to:

```ts
remoteCompactionV2: true,
```

- [ ] **Step 4: Verify GREEN and static checks**

Run the focused test, targeted ESLint, `npm.cmd run typecheck`, `npm.cmd run test:logic`, and `npm.cmd run architecture:impact -- --changed`.

- [ ] **Step 5: Commit**

Commit only the contract and its regression test with `fix(runtime): use native compaction v2`.

### Task 2: Complete the existing Worker Activity registry

**Files:**
- Modify: `src/lib/temporal/activities/index.ts`
- Modify: `src/lib/temporal/worker.ts`

**Interfaces:**
- Consumes: `TaskWorkflowActivities` and the existing `reportTaskRetry` implementation.
- Produces: a Worker activity namespace that statically conforms to every Task Workflow Activity.

- [ ] **Step 1: Add the compile-time conformance guard**

Import `TaskWorkflowActivities` and assign the imported activity namespace to a typed registry passed to `Worker.create`:

```ts
const registeredActivities: typeof activities & TaskWorkflowActivities = activities
```

- [ ] **Step 2: Run typecheck to verify RED**

Expected: FAIL because `reportTaskRetry` is required by `TaskWorkflowActivities` but absent from the activity export namespace.

- [ ] **Step 3: Export the existing Activity**

Add `reportTaskRetry` to the named exports from `src/lib/temporal/activities/task.ts` in `src/lib/temporal/activities/index.ts`.

- [ ] **Step 4: Verify GREEN and focused static checks**

Run typecheck and targeted ESLint for the two files.

- [ ] **Step 5: Commit**

Commit only the registry conformance and export with `fix(temporal): register task retry projection`.

### Task 3: Integrate and verify the user trigger

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: the existing workspace assistant continuation button and Product Turn admission path.
- Produces: a completed recovery Turn without a new legacy compact-endpoint failure.

- [ ] **Step 1: Integrate the verified commits and reload the host services**

The Worker must reload to consume the corrected Activity registry. Do not mutate the Task row or resubmit provider work.

- [ ] **Step 2: Wait for the current media task to reach a terminal status**

Read the Task and Temporal Workflow state only. Preserve unrelated `.superpowers/` files and the separate SSE branch.

- [ ] **Step 3: Verify service health**

Confirm the workspace API responds before browser interaction.

- [ ] **Step 4: Trigger recovery from the UI**

Open the affected workspace, click “继续未完成任务” once, and wait for a terminal assistant response.

- [ ] **Step 5: Verify durable facts**

Read the latest Product Turn and task summaries. Confirm no new `responses/compact` 404, no duplicated completed task submission, and the recovery Turn reached its correct terminal status.
