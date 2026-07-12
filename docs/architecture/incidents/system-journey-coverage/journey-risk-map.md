# Product journey and risk map

This map is derived from production pages, API routes, deployment features,
operation/task registries, and confirmed user goals. It is not a route-coverage
checklist. Several routes may support one journey, and a route does not justify
a standalone browser test.

## Journey families

| ID | Independent user result | Production entry | Current Golden evidence | Required risk boundaries | Status |
| --- | --- | --- | --- | --- | --- |
| PJ-AUTH-01 | A new user registers, receives an authenticated session, reloads, signs out, and signs in again | `/{locale}/auth/signup`, `/{locale}/auth/signin` | `GJ-AUTH-UNAUTHENTICATED-DENIAL` covers redirect/API 401; `GJ-AUTH-SESSION-RECOVERY` covers registration, duplicate-name rejection without user replacement, reload, UI logout, rejected password, restored login, and read-only user oracle | none in the admitted credential/session core | core path executed green |
| PJ-PROJECT-01 | A user creates, lists, searches, edits, opens, and deletes a project without affecting another project | `/{locale}/workspace`, `/api/projects/**` through the UI | `GJ-PROJECT-CRUD-DURABILITY` double-clicks create and drives CRUD; `GJ-PROJECT-CREATE-RESPONSE-LOSS` drops the browser response only after the real server returns 201, then reloads and checks exactly one durable owner/name row | pagination | core CRUD and response-loss executed green |
| PJ-STORY-01 | An empty project becomes a durable final video through the real edit-first workflow | `/{locale}/home` to `/{locale}/workspace/{projectId}` | `GJ-MAIN-STORY-TO-FINAL-DELIVERABLE` plus declared stage probes | every suspension, every async reload, duplicate submit, downstream checkpoint continuation | present but not yet green on this baseline |
| PJ-REVISION-01 | A user modifies or regenerates an existing asset/panel/video and can select or revert the intended render | Workspace Canvas and asset actions | No independent browser journey | retry, double click, old result late arrival, selected render stability, reload | gap |
| PJ-ASSET-HUB-01 | A user creates/reuses an asset in the Asset Hub and copies it into a project with correct ownership | `/{locale}/workspace/asset-hub` and project asset library | `GJ-ASSET-HUB-PROJECT-REUSE` creates the source and target through both real UIs, imports through the production copy route, reloads, and checks durable owner/source/appearance identity. `GJ-ASSET-HUB-CROSS-PROJECT-DENIAL` composes two real users, two projects and a tampered production request. | duplicate copy, deletion, upload/generation failure | core reuse green; cross-project fail-before returned 200 and is registered as BUG-ASSET-001 |
| PJ-RECOVERY-01 | A retryable background failure recovers to one final resource without duplicate effects | Production task owner through a user action | `GJ-WORKER-RETRY` uses canonical video Approval, a real Task/queue/worker and a controlled first 503; attempt two completes once and survives reload. `GJ-TASK-COMPLETES-DURING-BROWSER-DISCONNECT` closes the page after durable submit and restores the next stage from a fresh page after background completion. | worker process exit | provider retry and browser-disconnect recovery executed green under external-owner discovery diagnostics; process-exit injection remains a gap |
| PJ-FAILURE-01 | A terminal provider failure is explicit and leaves no fabricated resource or charge | Production task owner through a user action | `GJ-PROVIDER-NONRETRYABLE-FAILURE` produces one failed video Task, one Operation, explicit failure and no final output; permanent path remained green after retry repair | primary error preservation across later failures, billing charge/refund | terminal provider path executed green under external-owner discovery diagnostics; billing remains gap |
| PJ-BILLING-01 | A cloud user sees a quote, approves one charge, receives one result, and sees one ledger entry | Approval UI, profile billing, production billing owner | Golden currently runs with `BILLING_MODE=OFF`; approval UI is not billing evidence | insufficient balance, frozen funds, double approval, retry/refund, ledger consistency | gap |
| PJ-PERMISSION-01 | One user cannot read, mutate, stream, fork, or delete another user's project/resources | Real browser sessions and protected product routes | `GJ-PROJECT-CROSS-USER-ISOLATION` covers list omission, direct URL, GET/PATCH/DELETE, Workflow Lab fork denial, no post-denial setup write, and owner-record survival | SSE/task state for an active foreign project | core ownership path executed green; active-task isolation remains |
| PJ-I18N-01 | The same critical user result works in Chinese and English without changing persisted locale/task semantics | `/zh/**`, `/en/**`, i18n navigation | `GJ-I18N-CRITICAL-PROJECT` registers and creates through English UI, switches through the product confirmation to Chinese, and checks one durable project identity before deletion | task output locale, error/approval presentation | user/project core executed green; async locale remains |
| PJ-DEPLOY-01 | Self-hosted and cloud editions expose only their declared capabilities while preserving the shared creation journey | `/api/deployment`, Navbar/profile/signup/pricing surfaces | `GJ-DEPLOY-SELF-HOSTED-CAPABILITIES` compares the public feature contract with signup/navigation visibility | cloud edition, forbidden cloud-only routes, shared cloud creation | self-hosted path executed green; cloud gap |
| PJ-PAYMENT-01 | A cloud recharge creates one checkout intent and one authoritative credit result | Profile recharge and Stripe boundary | No Golden evidence | cancel, duplicate webhook, replay, amount/currency, external sandbox boundary | candidate; safe Stripe boundary required |

## Stable workflow checkpoints

The existing production Workflow Lab can fork checkpoints for the edit-first
workflow. A checkpoint is admissible only after the real longest mainline has
created it. Initial declared stable stages are:

- script ready for review;
- production bible ready for review;
- visual style choice;
- generated assets ready for review;
- shot execution/storyboard generation boundaries;
- videos ready to generate;
- final render ready to start.

The discovery pass must prove that each declared checkpoint exists, belongs to
the source episode, can be forked only by an authorized user, and resumes through
production UI/API owners. Missing checkpoints are evidence, not permission to
write rows directly.

## Cross-cutting transition risks

Every applicable journey is evaluated against these transitions rather than by
duplicating every parameter combination:

1. reload before submit, immediately after submit, while queued, while running,
   after durable completion, and after the user-visible result;
2. duplicate click/tool/event/delivery with one durable effect;
3. retryable attempt failure versus terminal business failure;
4. browser disconnect or lost response after the server committed;
5. worker/process exit before and after submission/settlement;
6. late or replayed event after a newer version/watermark;
7. cross-user and cross-project identity isolation;
8. billing quote, approval, charge, refund/release, and ledger consistency;
9. locale and deployment capability preservation.

Executed transition evidence now includes browser response loss after a durable
project commit, double Approval, provider first-fail-then-success, permanent
provider rejection, page disconnect during a production Task, and a real SSE
reconnect from an older composite cursor. The stale-cursor replay preserved the
same workflow stage and identical Task, TaskEvent, Operation and duplicate
identity sets. Direct worker-process death and a deliberately reordered live
event remain explicit gaps.
