# Historical regression and observed incident matrix

This matrix distinguishes observed production facts, candidate emergency
changes in the original worktree, and the independent proof required from the
Golden Journey. A candidate fix is never accepted because the current code and
its new test agree; the scenario must fail under the recorded old semantics
and pass under the repaired semantics.

| Incident | Observed symptom | Root cause evidence | Escaped defense | Required independent proof |
| --- | --- | --- | --- | --- |
| Choice post-fence rejection | `PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REJECTED reason=run_not_running` after a durable card was visible | execution eligibility was inferred again from the business Run status after Choice settlement | module tests allowed a Choice-specific outcome instead of proving fence/outcome separation | real Operation invocation creates a Choice, commits `awaiting_choice`, renders once, reloads, and never reports Tool failure |
| Partial reload view | live prose and card became card-only after reload | prose and waiting handoff could settle through different failure paths | reload tests did not execute the real Choice invocation/failure combination | reload at every pending Choice/Approval/Task boundary and compare persisted Thread, Session, DOM, and canonical identities |
| Choice consume stale watermark | `PROJECT_AGENT_RUN_EVENT_STALE expectedVersion=15 actualVersion=16` after a legitimate follow-up event | creation watermark was reused as the later consume precondition | consume tests used a frozen Run snapshot | create Choice, advance the Run through a legal event, consume through the browser, and prove exactly-once resolution |
| Bible review vocabulary mismatch | `EDIT_FIRST_BIBLE_REVIEW_NOT_READY:ready_for_review` | entity status `ready_for_review` was compared with workflow stage `bible_ready_for_review` | fixture copied the wrong implementation string | enter the card from a production-created Bible state; fixture must be built from and diffed against the same canonical state |
| Missing deterministic continuation | successful `confirm_bible` followed by `PROJECT_AGENT_WORKFLOW_CONTINUATION_MISSING: generate_edit_style_previews` | route bypass was correctly removed, but continuation ownership moved to probabilistic model behavior; runtime only punished absence | routing tests use `simulateSecondTurnAfterFirstWorkflowTool` and also assert the failure as correct behavior | local HTTP model stops after successful confirmation; orchestrator must still reach the declared Approval/Task/Choice boundary without repeating confirmation |
| Duplicate success/failure presentation | two confirmation successes and two AI failure cards while the database had one `confirm_bible` Activity | live, persisted, Activity, and Run terminal projections are not proven to share one canonical presentation identity | component tests do not execute stream + persistence + reload | count browser-visible lifecycle items by durable identity before and after reload; each fact is rendered once |
| ReactFlow maximum update depth | `StoreUpdater.useIsomorphicLayoutEffect` / `Maximum update depth exceeded` without user selection | controlled ReactFlow props and streaming measurement can feed render-driven writes back into the store | renderer and lifecycle unit tests do not run real ReactFlow under streaming resize | Playwright observes a streaming Canvas with zero console/page errors and a bounded render/measurement stabilization window |

## Baseline emergency changes excluded from this worktree

The original worktree currently contains five modified files in three groups:

1. `ProjectWorkspaceCanvas.tsx`: callback/options stabilization and suppression
   of measurement writeback during streaming/running lifecycle.
2. `interruptions.ts` plus `interruption-consume.test.ts`: consume against the
   current locked Run fence instead of the historical creation watermark.
3. `choice-card.ts` plus `choice-card-script-style.test.ts`: compare the Bible
   entity with `ready_for_review` rather than the workflow stage name.

These changes remain uncommitted in the original worktree. The diagnostic
branch begins before them so the corresponding scenarios can obtain real red
evidence. They may be reapplied only after the complete first scan and root
cause grouping.

## Required first-scan report columns

Every scenario writes a row with:

- Git commit and scenario contract version;
- project/user/episode scope;
- start and expected terminal workflow stages;
- browser step and first hard blocker;
- every console, page, network, SSE, worker, and queue anomaly observed before
  the blocker;
- Run, Activity, Wait, Interaction, Task, and domain-resource snapshots;
- visible message/card identities and duplicate counts;
- reload comparison;
- classified result (`PASS`, `SYSTEM_FAIL`, `EXPECTED_FAILURE`,
  `INFRASTRUCTURE_FAIL`);
- candidate shared root cause, which is analysis metadata rather than a test
  oracle.

