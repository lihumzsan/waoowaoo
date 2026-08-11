# Waoowaoo Free Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all user-facing and runtime product billing/payment/pricing behavior while preserving the single Operation Plan -> Task -> provider -> terminal lifecycle and non-billing destructive confirmations.

**Architecture:** Billing is deleted as an authority, not disabled behind `BILLING_MODE=OFF`. Operation plans retain canonical input, placement, idempotency, task/resource ownership, and optional destructive-operation grants; quote, freeze, settlement, balance, and payment state are removed. A free-product contract checker and architecture module document make future remote merges fail when billing owners or schema facts return.

**Tech Stack:** TypeScript, Next.js, Prisma/MySQL schema, Zod contracts, Vitest, Node contract scripts, next-intl, Stripe removal.

## Global Constraints

- Do not apply any database migration or delete live/shared data.
- Preserve historical migrations as audit history; only add a new cleanup migration.
- Do not retain `BILLING_MODE=OFF`, zero-price rows, empty quotes, `billable: false`, or no-op ledger compatibility paths.
- Keep Operation Plan, PlanSnapshot, OperationExecution, Task/Resource lifecycle, Provider fence, and destructive-operation approval.
- Do not add a second free submitter, task state machine, terminal writer, or provider fallback.
- `/pricing` must redirect server-side to the locale-aware home page; no pricing UI remains reachable from navigation/profile.
- Provider account hard-limit errors remain upstream availability errors, not local billing facts.
- The MOSS retry/output/HTTP/i18n findings remain a later serial phase and must not reintroduce billing concepts.
- Every production change follows RED -> GREEN -> REFACTOR; run the closest verification before broader checks.

---

### Task 1: Establish the free-product contract checker

**Files:**
- Create: `tests/contracts/free-product-contract.test.ts`
- Create: `scripts/check-free-product-contract.mjs`
- Modify: `package.json:41-80`

**Interfaces:**
- Produces `checkFreeProductContract({ rootDir })` for the CLI and contract test.
- CLI exits `0` only when current production sources, Prisma schema, package dependencies/scripts, and active routes satisfy the free-product contract.
- Historical migrations, Git history, `docs/superpowers/**`, and `docs/architecture/**` are excluded from forbidden-path scans.

- [ ] **Step 1: Write the failing contract test.**

  Test the exported checker against a temporary fixture containing `src/lib/billing/index.ts`, a payment route, a Stripe dependency, a Prisma `UserBalance` model, and a `BILLING_MODE` script. Assert that the result contains one violation for each category. Add a clean fixture containing only Operation Plan, Task, and destructive approval files and assert it passes.

- [ ] **Step 2: Run the contract test and confirm the expected RED result.**

  Run: `npx.cmd vitest run tests/contracts/free-product-contract.test.ts`

  Expected: FAIL because `scripts/check-free-product-contract.mjs` does not yet exist.

- [ ] **Step 3: Implement the minimal checker.**

  In `scripts/check-free-product-contract.mjs`, use `node:fs` and `node:path` to:

  - reject active directories/routes under `src/lib/billing`, `src/lib/payments`, payment APIs, payment-only paid-beta APIs/components, pricing UI, costs, transactions, and balance endpoints;
  - reject `stripe` and `@stripe/stripe-js` in `package.json` dependencies and active production imports;
  - read `prisma/schema.prisma` and reject the forbidden billing models/fields listed in the design spec;
  - reject billing/pricing payment maintenance scripts from package scripts;
  - reject active pricing/retail/billing registry symbols and billing imports;
  - ignore historical migrations, documentation, fixtures, and the checker’s own test fixture paths;
  - export `checkFreeProductContract` and provide a CLI that prints every violation and exits nonzero.

- [ ] **Step 4: Run the contract test and verify it is GREEN.**

  Run: `npx.cmd vitest run tests/contracts/free-product-contract.test.ts`

  Expected: PASS for the synthetic violating and clean fixtures.

- [ ] **Step 5: Add the standalone checker command.**

  Add `check:free-product-contract` to `package.json`, but do not invoke it from `typecheck` yet. The current tree intentionally still contains billing and must remain verifiable while the later removal tasks run.

- [ ] **Step 6: Commit the guard independently.**

  Run: `git add scripts/check-free-product-contract.mjs tests/contracts/free-product-contract.test.ts package.json && git commit -m "chore(architecture): guard free product contract"`

### Task 2: Remove billing from the Task and Operation execution contract

**Files:**
- Modify: `src/lib/task/types.ts`
- Modify: `src/lib/task/definition.ts`
- Modify: `src/lib/task/transactional-create.ts`
- Modify: `src/lib/task/approved-plan-submitter.ts`
- Modify: `src/lib/task/submitter.ts`
- Modify: `src/lib/operations/planning.ts`
- Modify: `src/lib/operations/operation-plan-snapshot.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/operations/registry.ts`
- Modify: `src/lib/workspace-resource/generation-request.ts`
- Test: `tests/contracts/workspace-resource-operation-conformance.test.ts`
- Test: `tests/contracts/free-operation-plan.contract.test.ts`

**Interfaces:**
- `CreateTaskInput` no longer accepts `billingInfo` or `billingMode`.
- `PlannedTask` contains execution/task/resource facts only; `TaskBillingInfo`, `TaskBillingPolicy`, `requirePlannedTaskBillingInfo`, and `quoteOperationPlan` are removed.
- `OperationPlanView` and `OperationPlanSnapshot` retain `normalizedInput`, `inputHash`, `planSnapshot`, and `planHash`, but no quote fields.
- `ApprovalGrant` keeps plan/input identity for destructive operations and no longer carries amount, currency, or quote identity.

- [ ] **Step 1: Write the failing free-operation contract test.**

  Add a contract test that builds one non-destructive `create_audio` plan and asserts its projected plan has tasks/resources and hashes but no `quote`, `quoteHash`, `billingInfo`, `billedAt`, `billable`, or credit fields. Add a destructive operation assertion that its grant still requires the canonical input hash and plan hash.

- [ ] **Step 2: Run the focused contract test and observe the expected RED result.**

  Run: `npx.cmd vitest run tests/contracts/free-operation-plan.contract.test.ts`

  Expected: FAIL because the current plan and task types still construct billing metadata and quotes.

- [ ] **Step 3: Remove billing facts from task types and transactional creation.**

  Delete billing types and billing parameters from `src/lib/task/types.ts`, remove `billingInfo`/`billedAt` persistence from `transactional-create.ts`, and make the transaction write only task/resource/dependency/outbox facts. Keep task dedupe, operation execution identity, and terminal event writes unchanged.

- [ ] **Step 4: Collapse submitter logic to one non-billing execution path.**

  Remove billing mode reads, approval checks that exist only for billable media, billing receipt projections, and balance preparation from `approved-plan-submitter.ts` and `submitter.ts`. Retain grant validation for operations whose confirmation policy is destructive, and use the same submitter for confirmed and non-confirmed operations.

- [ ] **Step 5: Remove quote construction while preserving plan identity.**

  In `planning.ts` and `operation-plan-snapshot.ts`, delete quote types, quote aggregation, quote hashing, credit visibility, and media billing filters. Keep task/resource scope validation, canonical input hashing, plan hashing, snapshot idempotency, and operation execution replay checks. Update all callers to consume the quote-free view.

- [ ] **Step 6: Remove media operation billing confirmation.**

  In `generation-ops.ts` and the operation registry, change media generation confirmation to `none` and remove `mediaKind`, `defaultSchemaId`, and billing-only alternative capability metadata. Keep output media type/schema identity and placement requirements so audio/image/video semantics remain explicit.

- [ ] **Step 7: Run focused tests and typecheck.**

  Run: `npx.cmd vitest run tests/contracts/free-operation-plan.contract.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts`

  Then run: `npm.cmd run typecheck`

  Expected: PASS with no billing field present in the free operation plan.

- [ ] **Step 8: Commit the execution-contract phase.**

  Run: `git add src/lib/task src/lib/operations src/lib/workspace-resource tests/contracts/free-operation-plan.contract.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts && git commit -m "refactor(operations): remove billing from task execution"`

### Task 3: Remove pricing and billing from AI registries and LLM execution

**Files:**
- Modify: `src/lib/ai-registry/types.ts`
- Modify: `src/lib/ai-registry/pricing-catalog.ts`
- Modify: `src/lib/ai-registry/pricing-retail.ts`
- Modify: `src/lib/ai-registry/pricing-coverage.ts`
- Modify: `src/lib/ai-registry/api-config-catalog.ts`
- Modify: `src/lib/ai-registry/catalog-utils.ts`
- Modify: `src/lib/ai-exec/llm-runtime.ts`
- Modify: `src/lib/ai-exec/media-preflight.ts`
- Modify: `src/lib/codex-model-gateway/contracts.ts`
- Modify: `src/lib/codex-model-gateway/proxy.ts`
- Modify: `src/lib/codex-model-gateway/openrouter-realtime-billing.ts`
- Modify: `src/lib/billing/llm-balance-gate.ts`
- Modify: `src/lib/billing/llm-realtime-settlement.ts`
- Modify: `src/lib/billing/llm-usage.ts`
- Modify: `tests/contracts/free-model-catalog.contract.test.ts`

**Interfaces:**
- Model registry exposes identity, capability, route, option schema, and provider availability; it does not expose retail prices or require price coverage.
- LLM/provider execution may retain raw provider usage for diagnostics but never writes a usage-cost fact or checks a user balance.

- [ ] **Step 1: Write the failing registry contract test.**

  Assert that the active model catalog can load a model with no retail price declaration, that API config output contains capability/configuration but no pricing display, and that LLM execution does not call a billing settlement entrypoint.

- [ ] **Step 2: Run the test and confirm RED.**

  Run: `npx.cmd vitest run tests/contracts/free-model-catalog.contract.test.ts`

  Expected: FAIL because the active registry still requires pricing coverage and runtime usage still imports billing settlement.

- [ ] **Step 3: Remove price ownership from registry contracts.**

  Delete `PricingApiType`, retail markup, pricing coverage enforcement, cost/retail model fields, pricing display projections, and model-config checks that only enforce price relationships. Keep model identity/capability/provider route validation strict.

- [ ] **Step 4: Remove LLM balance and settlement calls.**

  Delete preflight balance gates and realtime settlement writes. Keep provider request execution, raw usage observation where operationally useful, error normalization, and provider-account availability diagnostics.

- [ ] **Step 5: Run focused tests, catalog checks, and typecheck.**

  Run: `npx.cmd vitest run tests/contracts/free-model-catalog.contract.test.ts`

  Run: `npm.cmd run check:capability-catalog`

  Run: `npm.cmd run typecheck`

- [ ] **Step 6: Commit the registry phase.**

  Run: `git add src/lib/ai-registry src/lib/ai-exec src/lib/codex-model-gateway tests/contracts/free-model-catalog.contract.test.ts && git commit -m "refactor(registry): remove product pricing contracts"`

### Task 4: Delete payment, paid-beta payment, billing, and pricing UI/API surfaces

**Files:**
- Delete: `src/lib/billing/**` after all non-billing consumers are removed
- Delete: `src/lib/payments/**`
- Delete: payment-only paid-beta services/components/routes
- Delete: `src/app/api/payments/**`
- Delete: user/project costs and transactions routes/components
- Delete: `src/app/[locale]/_pricing-glass/**` payment/pricing surfaces
- Modify: `src/app/[locale]/pricing/page.tsx`
- Modify: `src/components/Navbar.tsx`
- Modify: `src/app/[locale]/profile/page.tsx`
- Modify: `src/lib/profile/sections.ts`
- Modify: profile and common locale dictionaries
- Modify: `package.json`, lockfile, deployment env checks
- Test: `tests/contracts/free-ui-routes.contract.test.ts`

**Interfaces:**
- `/pricing` remains a server-side locale-aware redirect to home.
- No payment/cost/transaction/balance route is registered.
- Profile sections contain no billing section; navbar contains no pricing or credit display.

- [ ] **Step 1: Write the failing route/UI contract test.**

  Assert that the route inventory has no payment/cost/transaction/balance endpoints, that the navbar route list has no pricing entry, and that the profile section registry has no billing section. Assert the pricing page returns a redirect response to the locale home path.

- [ ] **Step 2: Run the focused contract test and confirm RED.**

  Run: `npx.cmd vitest run tests/contracts/free-ui-routes.contract.test.ts`

  Expected: FAIL because current payment routes and pricing/profile UI are present.

- [ ] **Step 3: Remove payment and billing routes/services.**

  Delete payment services/routes and payment-only paid-beta admission/group-access code. Preserve generic announcements and any non-payment beta waitlist only if a live non-billing owner still consumes it; otherwise remove its orphaned route and schema dependency in Task 5.

- [ ] **Step 4: Remove pricing/profile billing UI and locale keys.**

  Remove pricing navigation, credit/balance/subscription displays, transaction table, billing profile section, payment callbacks, Stripe client code, and pricing/payment locale keys. Keep API configuration and provider capability configuration.

- [ ] **Step 5: Implement the old pricing URL redirect.**

  Replace the pricing page body with the project’s locale-aware server redirect helper targeting the locale home route. Do not render a hidden pricing page or a zero-price compatibility card.

- [ ] **Step 6: Remove Stripe dependencies and billing scripts.**

  Remove Stripe packages, payment environment validation, billing cleanup/reconciliation scripts, payment test bootstrap variables, and package scripts that only serve billing.

- [ ] **Step 7: Run UI/API contract tests and typecheck.**

  Run: `npx.cmd vitest run tests/contracts/free-ui-routes.contract.test.ts`

  Run: `npm.cmd run typecheck`

- [ ] **Step 8: Commit the surface-removal phase.**

  Run: `git add src/app src/components src/features src/lib/profile messages package.json package-lock.json && git commit -m "refactor(product): remove payment and pricing surfaces"`

### Task 5: Remove billing schema facts and create the unapplied cleanup migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260811130000_remove_billing_schema/migration.sql`
- Modify: `src/lib/paid-beta/**` only where payment ownership is removed
- Test: `tests/contracts/free-schema.contract.test.ts`

**Interfaces:**
- Current Prisma schema contains no user billing/payment entities or billing-only fields.
- Historical migrations remain untouched.
- The new migration is explicit, reviewable, and not executed by any command in this task.

- [ ] **Step 1: Write the failing schema contract test.**

  Read `prisma/schema.prisma` and assert the forbidden models/fields are absent while `User`, `Project`, `Task`, `OperationPlanSnapshot`, `ApprovalGrant`, and `OperationExecution` retain their non-billing relations and identities.

- [ ] **Step 2: Run the schema test and confirm RED.**

  Run: `npx.cmd vitest run tests/contracts/free-schema.contract.test.ts`

  Expected: FAIL because the current schema still declares balances, subscriptions, paid-beta payment attempts, usage costs, and task/approval billing fields.

- [ ] **Step 3: Remove current schema billing entities and relations.**

  Remove `UsageCost`, `UserBalance`, `LlmBillingMeter`, `Subscription`, `SubscriptionGrant`, `BalanceFreeze`, `BalanceTransaction`, payment-only paid-beta models, user relations, preference confirmation field, Task billing fields, OperationPlan quote fields, ApprovalGrant quote fields, and only the relations/indexes that reference them.

- [ ] **Step 4: Create the cleanup migration without applying it.**

  Generate a migration directory manually with `apply_patch`. Order foreign-key drops before table drops, then remove columns/indexes from surviving tables. Use the actual mapped table/constraint names from the current schema and migration history. Do not use `prisma migrate deploy`, `prisma db push`, or any database connection.

- [ ] **Step 5: Run Prisma validation and the schema contract.**

  Run: `npx.cmd vitest run tests/contracts/free-schema.contract.test.ts`

  Run: `npx.cmd prisma validate`

  Run: `npx.cmd prisma generate`

  Inspect the migration text and confirm no command executed it.

- [ ] **Step 6: Commit the schema phase.**

  Run: `git add prisma/schema.prisma prisma/migrations/20260811130000_remove_billing_schema/migration.sql src/lib/paid-beta tests/contracts/free-schema.contract.test.ts && git commit -m "refactor(data): remove billing schema facts"`

### Task 6: Replace the architecture module and make the guard merge-safe

**Files:**
- Create: `docs/architecture/modules/free-product.md`
- Modify: `docs/architecture/modules.json`
- Modify: `scripts/check-free-product-contract.mjs`
- Modify: `package.json`
- Test: `tests/contracts/free-product-contract.test.ts`

**Interfaces:**
- `free-product.md` is the sole durable product contract for the absence of user billing and the separation of destructive confirmations.
- `modules.json` maps all active execution/schema/UI paths to the free-product module and the guard script.

- [ ] **Step 1: Write the failing architecture mapping assertion.**

  Extend the contract test to assert `modules.json` contains a `free-product` module covering the active free execution/planning/schema paths, and does not map active paths to `billing-approval`.

- [ ] **Step 2: Run the test and confirm RED.**

  Run: `npx.cmd vitest run tests/contracts/free-product-contract.test.ts`

  Expected: FAIL because `billing-approval` is still the active architecture mapping.

- [ ] **Step 3: Write the durable free-product module contract.**

  Document only stable invariants: no billing owner/writer, free execution through the single plan/task lifecycle, preserved destructive confirmation, historical migration policy, and the guard as enforcement. Do not copy current file lists, thresholds, implementation steps, or migration SQL into the architecture contract.

- [ ] **Step 4: Update module routing and guard wiring.**

  Replace the active billing module mapping with `free-product`, map the checker to relevant paths, and keep historical migration paths outside current production mapping. Only now invoke the checker from the normal typecheck/verification entrypoint; earlier phases must remain testable without the final root contract.

- [ ] **Step 5: Run the full guard and architecture checks.**

  Run: `npm.cmd run check:free-product-contract`

  Run: `npm.cmd run architecture:impact -- src/lib/operations src/lib/task prisma/schema.prisma`

  Run: `npm.cmd run typecheck`

- [ ] **Step 6: Commit the durable contract phase.**

  Run: `git add docs/architecture/modules/free-product.md docs/architecture/modules.json scripts/check-free-product-contract.mjs package.json tests/contracts/free-product-contract.test.ts && git commit -m "docs(architecture): enforce free product boundary"`

### Task 7: Verify real trigger paths and finish the free-product phase

**Files:**
- Test/inspect: `tests/contracts/**`, `tests/integration/provider/**`, `tests/integration/task/**`, `tests/integration/temporal/**`
- Verify: `src/app/[locale]/pricing/page.tsx`, operation execute routes, Task handlers, provider adapters

**Interfaces:**
- A non-destructive `create_audio` operation reaches the existing Task/Temporal/provider/terminal path without quote, grant, balance, or billing payload.
- A destructive operation still requires its canonical input-bound grant.
- No payment/cost/pricing route or active dependency remains.

- [ ] **Step 1: Run focused contract suites.**

  Run: `npm.cmd run test:conformance`

  Run: `npx.cmd vitest run tests/contracts/free-product-contract.test.ts tests/contracts/free-operation-plan.contract.test.ts tests/contracts/free-model-catalog.contract.test.ts tests/contracts/free-ui-routes.contract.test.ts tests/contracts/free-schema.contract.test.ts`

- [ ] **Step 2: Run provider/task/Temporal suites that remain applicable.**

  Run: `npm.cmd run test:critical:provider`

  Run: `npm.cmd run test:critical:task`

  Run: `npm.cmd run test:critical:temporal`

  Do not run deleted billing suites as evidence; report any suite manifest updates needed because billing semantics were intentionally removed.

- [ ] **Step 3: Run build and static checks.**

  Run: `npm.cmd run typecheck`

  Run: `npm.cmd run build:verify`

  Run: `git diff --check`

- [ ] **Step 4: Inspect the final tree for forbidden reintroduction.**

  Run: `npm.cmd run check:free-product-contract`

  Run: `rg -n "BILLING_MODE|billable|billingInfo|billedAt|quoteSnapshot|quoteHash|UserBalance|Subscription|BalanceFreeze|BalanceTransaction|UsageCost|stripe|credits|payment" src prisma/schema.prisma package.json`

  Expected: only explicitly retained upstream-error wording, historical migration references, and the free-product documentation/checker allowlist remain; no active product owner or writer remains.

- [ ] **Step 5: Commit verification metadata only if required by the repository.**

  If test-suite manifests or architecture routing require updates due deleted billing suites, commit only those targeted changes with `git add` and `git commit -m "test: align suites with free product contract"`. Otherwise leave no verification-only changes.

- [ ] **Step 6: Record the unapplied migration and residual blind spots.**

  Final delivery must state the exact migration path, that it was not executed, the real trigger paths verified, any environment-limited checks, and the next serial phase for MOSS audio fixes.
