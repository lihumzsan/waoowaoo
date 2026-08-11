# Free Product Hard-Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining billing compatibility paths while making free planned media execution direct, durable, and safe.

**Architecture:** Non-destructive planned operations execute from the persisted PlanSnapshot using its existing `(planSnapshotId, requestId)` uniqueness boundary. Destructive operations retain an input-bound ApprovalGrant and share the same execution lifecycle. The database migration is a deliberate final cutover that permanently deletes legacy billing data before the new runtime starts.

**Tech Stack:** TypeScript, Next.js, Prisma/MySQL, Temporal, Vitest, Zod, next-intl.

## Global Constraints

- The user authorized permanent deletion of all legacy billing data.
- No zero-price, empty-quote, no-op ledger, compatibility column, or dual-path fallback may remain.
- The migration runs only after App/Worker are stopped and only after code verification is complete.
- A non-destructive operation must not create or require ApprovalGrant state.
- Destructive confirmation remains input-, plan-, and request-bound.
- Tests must assert real persisted/contract behavior rather than source text or mocked implementation calls.

---

### Task 1: Repair the current build blocker

**Files:**
- Modify: `src/lib/operations/submit-operation-task.ts`

**Interface:** `submitOperationTaskBatch` continues returning persisted task results; `persisted` is immutable after the single persistence call.

- [ ] Add no test: this is a lint-only local binding correction with no behavior change.
- [ ] Replace the declaration and later assignment with `const persisted = await persist(operationExecutionTransaction)`.
- [ ] Run `npm.cmd run build:verify` and confirm the previous `prefer-const` error is absent.
- [ ] Commit with `fix(build): restore production build verification`.

### Task 2: Preserve MOSS negative-prompt bytes

**Files:**
- Modify: `src/lib/workspace-resource/generation-request.ts`
- Modify: `src/lib/workspace-resource/generation-contract.ts`
- Modify: `tests/contracts/comfyui-moss-soundeffect.contract.test.ts`

**Interface:** a sound `negativePrompt` must be nonblank and at most 100,000 characters, while preserving its exact JavaScript string value through request parsing and frozen task payload parsing.

- [ ] Add a contract test with a literal negative prompt containing leading space, trailing newline, and interior whitespace. Assert `buildMossSoundEffectPromptGraph` receives the literal unchanged and `parseWorkspaceResourceGenerationTaskPayload` preserves it.
- [ ] Run `npx.cmd vitest run tests/contracts/comfyui-moss-soundeffect.contract.test.ts`; confirm the new assertion fails because the schema trims input.
- [ ] Replace both `.trim().min(1)` schemas with a string length bound plus `refine((value) => value.trim().length > 0)`; do not transform the value.
- [ ] Re-run the focused contract test and commit with `fix(audio): preserve MOSS negative prompt bytes`.

### Task 3: Make free PlanSnapshot execution direct

**Files:**
- Modify: `src/lib/operations/planned-operation-invocation.ts`
- Modify: `src/lib/operations/durable-dispatch.ts`
- Modify: `src/lib/temporal/operation-execution/contracts.ts`
- Modify: `src/lib/operations/durable-execution.ts`
- Modify: `src/lib/temporal/activities/operation-execution.ts`
- Modify: `src/lib/adapters/api/execute-project-agent-operation.ts`
- Modify: `src/lib/query/operation-plan-client.ts`
- Test: `tests/integration/task/` or the closest existing real Prisma/Temporal plan-execution contract

**Interface:** introduce one planned execution command with `planSnapshotId`, `operationRequestId`, and either `approval: { kind: 'none' }` or `approval: { kind: 'destructive_grant', approvalGrantId }`. The command identity and `OperationExecution` uniqueness derive from `planSnapshotId + operationRequestId`.

- [ ] Add an integration contract that persists a `create_audio` PlanSnapshot and dispatches it without a grant. Assert its OperationExecution has `approvalGrantId: null`, the same snapshot/request identity, and the planned task is created once.
- [ ] Run the contract and confirm it fails because the adapter requires `OPERATION_APPROVAL_GRANT_REQUIRED`.
- [ ] Extract the shared snapshot-scope/revalidation/commit behavior from approved-plan invocation. Add direct execution for `confirmation.kind === 'none'`; require a grant only for destructive confirmation. Reuse the existing `OperationExecution` table and its unique `[planSnapshotId, requestId]` key.
- [ ] Update the API client and route payload to pass a plan snapshot identity for free operations and reject stray grants for them.
- [ ] Run the targeted integration contract, `npm.cmd run typecheck`, and commit with `refactor(operations): execute free plans without grants`.

### Task 4: Remove confirmation UI and MCP grant issuance for free plans

**Files:**
- Modify: `src/features/project-workspace/canvas/actions/useCanvasOperationAction.ts`
- Modify: `src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx`
- Modify: `src/lib/wao-mcp/production-executor.ts`
- Delete or rename: `src/lib/query/use-asset-operation-billing-plan.ts`
- Test: closest Canvas operation action and MCP production-executor contracts

**Interface:** a Canvas `confirmation: 'none'` request executes after plan persistence without entering `confirming`; destructive actions retain their existing confirmation state. MCP free plans dispatch directly and never call `issueWaoMcpApprovalGrant`.

- [ ] Add a behavior test proving a free Canvas request does not expose pending confirmation and a MCP free plan does not produce an approval-grant request.
- [ ] Run it and confirm it fails against the current `setPhase('confirming')`/grant path.
- [ ] Route free Canvas and MCP calls through the direct planned dispatcher; retain the destructive modal and destructive grant proof.
- [ ] Re-run the focused tests, then commit with `fix(product): remove free-generation confirmation flow`.

### Task 5: Delete remaining billing/product compatibility surfaces

**Files:**
- Modify/Delete: `src/lib/user-api/api-config-pricing-display.ts`, `src/lib/user-api/api-config-types.ts`, `src/lib/user-api/api-config-service.ts`, `src/lib/user-api/runtime-config.ts`
- Modify/Delete: `src/app/[locale]/profile/components/api-config/**`
- Modify: `src/lib/ai-exec/llm-runtime.ts`, LLM callers, `src/lib/operations/domains/config/user-preference-ops.ts`, `src/lib/operations/types.ts`, `src/lib/operations/write-authority.ts`
- Modify: `tests/setup/**`, `package.json`, `messages/en/legal.json`, `messages/zh/legal.json`, related legal/refund locale files, and project-agent prompt templates

**Interface:** API-config models carry identity and capability only, not prices; no user preference accepts billing settings; tests use system/Temporal bootstrap names; active user-facing copy has no product credits, purchases, Stripe, quotes, or billing approval.

- [ ] Add controlled free-product-checker fixtures for a price response field, a `BILLING_MODE` command value, a billing prompt file, and legal Stripe copy. Each must independently produce a checker violation.
- [ ] Run `npx.cmd vitest run tests/contracts/free-product-contract.test.ts`; confirm the new cases fail because the checker allows them.
- [ ] Delete rather than neutralize all fields, renderers, no-op functions, environment names, prompt rules, preference fields, legacy kinds, and legal copy listed above. Reject removed external input through strict schemas rather than silently accepting it.
- [ ] Update all consumers and run the focused checker contract plus `npm.cmd run typecheck`.
- [ ] Commit with `refactor(product): delete remaining billing compatibility`.

### Task 6: Make the free-product guard and architecture documentation authoritative

**Files:**
- Modify: `scripts/check-free-product-contract.mjs`
- Modify: `tests/contracts/free-product-contract.test.ts`
- Modify/Delete: `docs/architecture/modules/free-product.md`, `docs/architecture/modules/billing-approval.md`, `docs/architecture/README.md`, `docs/architecture/modules.json`, `docs/architecture/modules/test-governance.md`

**Interface:** the guard checks active source, package command values, prompt templates, and locale documents; only historical migrations and provider-native availability classification are excluded. Architecture routing exposes free-product as the sole active product boundary and does not map historical billing migrations.

- [ ] Extend the checker test fixture to include `.txt` and `.json` active files plus forbidden identifiers in a TypeScript response contract.
- [ ] Run the focused test and confirm it fails before the checker knows those file types and symbols.
- [ ] Add narrow semantic checks and explicit allowlists; delete the retired billing architecture document and links; remove the obsolete billing critical suite row.
- [ ] Run `npm.cmd run check:free-product-contract`, architecture impact, and the focused contract; commit with `docs(architecture): enforce the free product boundary`.

### Task 7: Apply the authorized destructive database cutover

**Files:**
- Use: `prisma/migrations/20260811130000_remove_billing_schema/migration.sql`

**Interface:** the live target schema has none of the deleted billing tables/columns and the current Prisma schema/client is the exact database contract.

- [ ] Stop the local App and Worker using their actual process identities; confirm no process continues to hold the application ports.
- [ ] Inspect the resolved database target and migration status without mutation; confirm it is the explicitly intended local database.
- [ ] Apply only `20260811130000_remove_billing_schema` through the normal migration command.
- [ ] Query `information_schema.tables` and `information_schema.columns` to prove the billing tables and removed columns no longer exist.
- [ ] Run `npx.cmd prisma validate`, `npx.cmd prisma generate`, the direct free-operation contract, and a destructive-operation authorization contract.
- [ ] Commit any migration metadata only if the migration command creates tracked metadata; report every permanently removed table and the absence of recovery data.

### Task 8: Final verification and review

**Files:** all changed files

- [ ] Run `npm.cmd run check:free-product-contract`.
- [ ] Run applicable focused free-product, sound, provider, task, and Temporal suites.
- [ ] Run `npm.cmd run typecheck`, `npm.cmd run build:verify`, and `git diff --check` as separate commands so a later success cannot hide a build failure.
- [ ] If a compatible ComfyUI endpoint is available, submit one real environmental sound effect and inspect its terminal Resource. Otherwise report that live-provider verification is unperformed.
- [ ] Request an independent code review before any integration decision.
