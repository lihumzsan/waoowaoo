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
| AI turn stops after a successful tool call | baseline: successful `confirm_bible` followed by `PROJECT_AGENT_WORKFLOW_CONTINUATION_MISSING: generate_edit_style_previews` | model prompt/context/completion protocol left an enabled obligation unaddressed; the repaired runtime preserves the completed handoff and classifies the turn as `PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED` | routing tests manufacture a second model turn or assert the failure as correct behavior | local HTTP model stops after successful confirmation; prior handoff remains durable, server never invokes the next operation from `nextAction`, and the product emits the declared recoverable AI-turn protocol result |
| Duplicate success/failure presentation | two confirmation successes and two AI failure cards while the database had one `confirm_bible` Activity | live, persisted, Activity, and Run terminal projections are not proven to share one canonical presentation identity | component tests do not execute stream + persistence + reload | count browser-visible lifecycle items by durable identity before and after reload; each fact is rendered once |
| ReactFlow maximum update depth | `StoreUpdater.useIsomorphicLayoutEffect` / `Maximum update depth exceeded` without user selection | controlled ReactFlow props and streaming measurement can feed render-driven writes back into the store | renderer and lifecycle unit tests do not run real ReactFlow under streaming resize | Playwright observes a streaming Canvas with zero console/page errors and a bounded render/measurement stabilization window |

## Diagnostic hunk disposition

The handoff moved the diagnostic worktree evidence into this independent
worktree. It was audited hunk by hunk before formal editing; it is neither an
unrelated dirty baseline nor an acceptable patch stack. The formal
dispositions are recorded in `root-cause-and-repair-plan.md`.

The original diagnostic groups were:

1. `ProjectWorkspaceCanvas.tsx`: callback/options stabilization and suppression
   of measurement writeback during streaming/running lifecycle.
2. `interruptions.ts` plus `interruption-consume.test.ts`: consume against the
   current locked Run fence instead of the historical creation watermark.
3. `choice-card.ts` plus `choice-card-script-style.test.ts`: compare the Bible
   entity with `ready_for_review` rather than the workflow stage name.

The Canvas suppression is deleted in favour of one-way ownership; the Choice
consume hunk is replaced by a current-lock plus execution-segment transaction;
and the Bible status correction is retained only as the canonical entity-state
comparison. The remaining diagnostic edits are either deleted or have a named
verification blind spot. No imported hunk is unrelated or of unknown
ownership.

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
