# Journey execution log

This log distinguishes collection, harness startup, executed tests, diagnostic
passes, and formal passes. A test that never reached Playwright execution is
not counted as failed product behavior and is never counted as passed.

## 2026-07-12 discovery runs

| Scope | Files / cases | Result | Evidence boundary |
| --- | ---: | --- | --- |
| Golden harness self-tests | 7 files / 34 tests | 34 passed; two independent service scopes verified | Provider protocols, exact external-boundary fixture, network policy, browser observation fail-closed filtering, scenario contracts, bounded names, and isolated MySQL/Redis ownership |
| Golden scenario mount proof | 32 declared scenarios | all mounted | Collection identity only; not behavior pass |
| New independent product suite `--list` | 4 files / 8 tests | 8 collected | Unauthenticated denial, auth/session, project CRUD, ownership, response loss, i18n, self-hosted capability, and global-to-project asset reuse |
| Product suite real run, attempt 1 | 2 files / then-5 tests | 0 executed | Scoped MySQL host handshake timed out before app startup |
| Product suite real run, attempt 2 | 2 files / then-5 tests | 0 executed | Same Docker Desktop new-port forwarding blind spot; bounded failure |
| Startup-failure cleanup probe | 1 runtime | expected infrastructure failure, cleanup passed | Both scoped containers and network removed; no `waoowaoo-golden-*` survivor |
| Downstream diagnostic staircase before the external Docker blind spot | 6 cases | 2 passed, 1 mainline failed, 1 interrupted, 2 not run | The two passes used marked TEMP diagnostics and prove discovery reach only, not formal product green |
| Focused model provider routing | 1 file / 14 tests | 14 passed | Includes live workflow-stage choice selection contract |
| Architecture structure checks | 51 mandatory guards / 7 architecture modules | passed | Structure and mount evidence only; not product behavior |
| Focused Asset Hub + auth/session rerun | 2 cases | Asset Hub passed; auth failed on stale client session, then passed after unique NextAuth client ownership | The first failure exposed server-cookie/client-cache divergence rather than being whitelisted |
| Full product suite after Asset/SSE/session fixes | 4 files / 8 tests | 7 passed / 1 failed | Cross-user denial exposed an unauthorized automatic episode write after project 403 |
| Auth/project/permission verification after initialization fix | 1 file / 4 tests | 4 passed | No page error or setup write after foreign-project denial; durable owner project survived until owner deletion |
| Final independent product matrix | 4 files / 8 tests | 8 passed / 0 failed / 0 skipped | Real Chromium, isolated MySQL/Redis, production app/worker, durable oracle and fail-closed browser observations; owned scope removed cleanly |
| Downstream checkpoint-to-final discovery staircase | 1 mainline + 6 downstream cases | 6 downstream passed / 1 known external-owner mainline failed | Real script, Bible, style, assets, video, chapter render, BGM, soundscape and final render reached a durable final output; TEMP Assistant/Canvas diagnostics mean downstream reachability, not formal green |
| Provider explicit terminal-failure variant | 7 executed cases | 7 passed | Canonical source plus downstream staircase and real video Approval; one permanent failed `video_group` Task, one Operation, explicit UI/workflow failure and no final output; TEMP external-owner lifecycle diagnostics remain |
| Model stop / duplicate tool / stream disconnect variants | 3 focused cases | 3 passed | Stop oracle preserves AI-initiated-action principle; duplicate call creates one durable Choice; stream disconnect fails explicitly without partial source/Interruption |
| Provider invocation retry integration before repair | 1 file / then-5 tests | existing cases passed; no transient-attempt case existed | The missing cross-attempt oracle explains why blanket permanent HTTP classification escaped |
| Provider invocation retry integration after repair | 1 file / 7 tests | 7 passed | Real MySQL proves accepted replay, distinct candidates, concurrent first claim, ambiguous zero-resubmit, transient same-attempt denial, exactly one concurrent attempt-two reclaim, permanent 422 closure and LLM replay |
| Worker retry fail-before Journey | 7 selected cases | setup/staircase passed; retry case failed at attempt one | Real OpenRouter-compatible boundary returned 503; worker emitted permanent `PROVIDER_SUBMISSION_REJECTED`, proving configured Task retry was unreachable |
| Worker retry Journey after repair | 7 executed cases | 7 passed in 2.2m | Real UI Approval → Task → Redis → worker → first 503 → DB attempt two → success; reload showed `ready_to_render_chapters`, one Operation and no failed duplicate; TEMP external-owner lifecycle diagnostics remain |
| Permanent provider failure after retry repair | 7 executed cases | 7 passed in 2.1m | Reverse protection: explicit terminal rejection still creates one failed Task and no retry/fabricated output |
| Approval double-submit, first attempt | 7 selected cases | 6 passed / 1 precondition failed | Screenshot proved the current Approval/button was visible; a generic observer misread an older tool-failure message as the current boundary, so no double click had occurred |
| Approval double-submit after oracle correction | 7 executed cases | 7 passed in 2.1m | Reloaded the current server-owned Approval, issued a real browser double click, and durable oracle proved exactly one ApprovalGrant and one `generate_episode_videos` OperationExecution |
| Task-completion disconnect, first injection | 7 selected cases | 6 passed / 1 precondition failed | Page closed before the void React handler's Approval request settled; durable oracle found zero Tasks for 180s, proving the intended “submitted then disconnected” boundary was never reached |
| Task completes while page disconnected | 7 executed cases | 7 passed in 1.9m | Waited for the real Approval response and queued/processing durable Task, closed the only page, observed completion through read-only MySQL, opened a new page and restored `ready_to_render_chapters`; one attempt-one Task, one Operation and no failed duplicate |
| Choice double-submit + legal watermark advance | 2 executed cases | 0 passed / 2 failed | Both reached the durable script-review Choice, then the real POST returned 502 `PROJECT_AGENT_RUN_EVENT_STALE` (stored fence 13, current 14). The interruption stayed pending and no second effect was created. This is independent reproduction of external-owner BUG-ASST-EXT-006; Canvas also emitted its already-recorded update-depth failure. No product assertion was weakened and no local root repair was attempted. |
| Stale SSE cursor replay, first oracle | 7 selected cases | 6 passed / 1 postcondition failed | Real old-cursor request and stable stage succeeded; Task/TaskEvent/Operation counts were unchanged. A global zero-duplicate assertion attributed two tool-call IDs already present in the canonical source to SSE instead of comparing the before/after identity set. |
| Task disconnect + real stale SSE cursor replay | 7 executed cases | 7 passed in 2.0m | After background completion and fresh-page recovery, session cursor was deliberately moved behind the latest Task event. The new `/api/sse?cursor=...` connection performed real server replay; workflow stage, Task/TaskEvent/Operation counts and inherited duplicate-identity sets remained exactly unchanged. |
| First complete checkpoint matrix | 20 executed cases | 14 passed / 6 failed in 11.6m | Exposed one missing transient checkpoint, three mutable-source/Approval driver defects, and two clones that projected later domain facts (`ready_to_generate_storyboard_images → ready_to_generate_videos`, `ready_to_render_final → completed`). Every failed probe attached a read-only durable oracle. |
| Reusable Approval checkpoint repair matrix | 10 selected cases | 8 passed / 2 failed in 8.2m | Storyboard-image repeated fork passed. Asset Approval failed stale-value validation; video Approval failed because plan-only target IDs collided on the second fork. No assertion was weakened. |
| Plan identity and active Approval verification | 9 selected cases, then 6 asset-focused cases | 8/9 then 6/6 | Repeated storyboard-image and video Approval checkpoints passed in 7.1s and 6.5s after pending-interruption authority and plan target identity repair. Exact asset red showed expected non-null requirement target versus clone-cleared target; preserving the mapped association made the unchanged probe pass in 6.4s. All runs used isolated MySQL/Redis, real app/worker, real browser UI and production Workflow Lab. TEMP external-owner Assistant/Canvas diagnostics mean these are downstream reachability evidence, not formal default-path green. |
| Approval plan atomicity after reserved identity contract | 3 files / 11 cases | 11 passed | Real scoped MySQL verifies batch commit, atomic Wait binding, Grant expiry and replay after `OperationPlan.reservedIdentityIds` was added; the scoped MySQL/Redis environment was removed cleanly. |
| Registry conformance after Journey expansion | 3 files / 97 cases | 97 passed | Production Assistant Choice, Canvas node and Task definition registries remain exhaustive; this is structure/capability evidence, not a browser product pass. |

Static validation after the product-family expansion: TypeScript passed,
targeted ESLint passed, the 8 product tests are collected by Chromium, and
multiple real runs fully started isolated MySQL, Redis, app and worker scopes.
Full `verify:push` has not run because the diff is still in discovery and
contains explicitly prohibited TEMP diagnostics.

## Counting rules

- A TEMP-DIAGNOSTIC-assisted pass is a downstream reachability result, never a
  formal pass.
- `--list`, registry validation and mount proof establish collection only.
- Infrastructure startup failure means product cases were not run.
- A formal Journey pass requires the default production path, browser result,
  read-only durable evidence, clean runtime observations, and no temporary
  bypass.
