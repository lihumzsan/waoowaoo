# Golden Journey scenario contracts

## Mainline contract

The mainline journey starts with a newly created project and episode and ends
only when the final video is durably available after a browser reload. It uses
the real UI for every user-owned action and the real production services for
every business transition.

Required checkpoints:

1. story prompt submitted;
2. intake Choice visible, reloaded, and resolved;
3. generated script visible and review Choice resolved;
4. production plan generated, reloaded, and confirmed with aspect ratio;
5. style generation Approval and Task complete;
6. style Choice resolved;
7. chapter/core edit planning complete;
8. asset generation complete and review Choice resolved;
9. shot execution plan complete;
10. storyboard plan and valid tiny images complete;
11. valid tiny shot videos complete;
12. chapter renders complete;
13. music and audio layers complete;
14. final render complete;
15. final page reload presents one durable deliverable and no pending
    lifecycle facts.

At each checkpoint the scenario asserts browser state, durable workflow stage,
Run/Activity/Wait/Interaction consistency, task terminal facts, canonical
message/card identity counts, and reload equivalence.

## Model behavior contracts

| Scenario | Provider behavior | Expected product outcome |
| --- | --- | --- |
| `model-normal-mainline` | streams valid text/tool calls required for content preparation | mainline reaches final durable deliverable |
| `model-stops-after-confirm` | returns successful confirmation tool call, then only prose and stops | prior success stays durable; server does not invoke the next operation from `nextAction`; product reports the declared recoverable AI-turn protocol result |
| `model-duplicates-tool-call` | repeats the same operation identity/input | one durable domain effect and an idempotent/rejected duplicate, never two effects |
| `model-stream-disconnect` | disconnects during text/tool-call streaming | committed facts remain recoverable; uncommitted facts do not appear; no automatic duplicate external submission |

## Infrastructure and concurrency contracts

| Scenario | Fault/action | Expected product outcome |
| --- | --- | --- |
| `choice-legal-watermark-advance` | legal Run event occurs between Offer creation and user response | Choice consumes exactly once against current eligibility |
| `choice-double-click` | two browser submissions race | one consumed decision and one conflict/idempotent response; one continuation |
| `approval-double-submit` | approval is submitted twice | one grant/invocation and no duplicate billing/task |
| `worker-retry` | first retryable local-provider attempt fails | no premature final business failure; one eventual terminal resource |
| `reload-each-suspension` | reload at every reached Choice, Approval, Task, and terminal boundary | DOM, Thread, Session, and durable lifecycle agree |
| `provider-nonretryable-failure` | local provider returns declared terminal failure | expected failed Task/Run semantics with no fabricated resource or fallback |

Duplicate Outbox delivery, late/duplicate SSE, and handoff write-boundary injection require controlled
fault seams inside the production lifecycle. They are intentionally not
faked in this test-only branch. Those seams and their tests must be added with
the corresponding architecture repair; until then they remain named
verification blind spots and prevent an “architecture complete” claim.

## Scenario-global observations

Each scenario declares whether a failed Run/Activity/Task is expected. Unless
explicitly expected, any of the following fails the scenario:

- browser `console.error`, `pageerror`, or unhandled rejection;
- API 4xx/5xx outside a declared conflict/error response;
- React update-depth or render-stabilization failure;
- worker, queue, Outbox, or provider protocol error;
- duplicate durable identity or duplicate browser projection;
- workflow stage, Run, Interaction/Wait, Task, and domain-resource
  contradiction;
- reload loss, reappearance of a consumed Interaction, or stale overwrite;
- dependency unavailable, skipped scenario, or timeout without a structured
  hard-block report.
