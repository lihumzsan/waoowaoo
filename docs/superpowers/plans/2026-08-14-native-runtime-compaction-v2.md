# Native Runtime Local Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long workspace-assistant conversations use the local compaction path selected by a native-authenticated provider identity, unblock the existing retrying media Task, and prove recovery from the workspace UI.

**Architecture:** Keep `ASSISTANT_RUNTIME_STATIC_CONTRACT` as the only runtime provider authority. Its one provider declaration maps to the sole `model_provider` and `model_providers` entry in `runtimeConfig`; no base URL or credentials are supplied, so native desktop ChatGPT authentication remains authoritative. Use the existing new-Turn continuation flow for recovery.

**Tech Stack:** TypeScript, Vitest, Next.js, Codex App Server, Prisma, in-app browser.

## Correction after first UI verification

The initial v2-only assumption was falsified after commit `d7f59c4d1`: a new assistant turn still failed with a plain `404` from the legacy ChatGPT compaction endpoint. In pinned Codex `0.147.0-alpha.6.6`, `remote_compaction_v2` chooses only between remote protocol variants; provider identity chooses remote versus local compaction. Replace the removed feature declaration with one provider whose name is not exactly `OpenAI`, while retaining `requires_openai_auth` and no explicit model-provider base URL or credentials. This is a static provider contract, not a fallback, proxy, retry owner, or second runtime configuration source.

## Global Constraints

- Do not modify or replay persistent media tasks; let the existing Temporal Workflow resume through its authored retry path.
- Do not add a compatibility fallback or a second runtime configuration source.
- Keep the previous SSE repair on its separate branch.
- UI verification must originate from the “继续未完成任务” button.

---

### Task 1: Superseded v2-only attempt

The post-commit UI verification falsified this task's premise. It is retained only as history; Task 3 replaces the v2 feature flag with the provider contract that controls local versus remote routing.

### Task 3: Route compaction through the native local provider

**Files:**
- Modify: `src/lib/assistant-runtime/runtime-access.ts`
- Modify: `tests/unit/assistant-runtime/runtime-access-contract.test.ts`

**Interfaces:**
- Consumes: `ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.modelProvider`
- Produces: one top-level `model_provider` plus exactly one matching `model_providers` definition, without a provider base URL, environment key, or bearer token.

- [ ] **Step 1: Verify RED**

Run `npm.cmd exec vitest run tests/unit/assistant-runtime/runtime-access-contract.test.ts` after changing the production-contract test to require the provider declaration. It must fail because the declaration is missing.

- [ ] **Step 2: Apply the minimal provider contract**

Add `wao-openai-local-compaction` with the deliberately non-`OpenAI` name `Wao OpenAI`, `requiresOpenAiAuth`, `supportsWebsockets`, and `supportsStandaloneWebSearch` all true. Remove `remoteCompactionV2` and its runtime override; emit the provider selection and its matching definition only in `runtimeConfig`.

- [ ] **Step 3: Verify GREEN and static checks**

Run the focused test, `npm.cmd run typecheck`, targeted ESLint for the code and test file, and `git diff --check`.

- [ ] **Step 4: Commit**

Commit the provider repair, regression test, and corrected spec/plan with `fix(runtime): route compaction locally`.

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

### Task 4: Integrate and verify the user trigger

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
