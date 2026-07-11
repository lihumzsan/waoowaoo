# Frozen-baseline scan

Baseline: `fb7d2fa42121409a469c3adaaaefa0f64b2c1ba6`

This scan ran without any production-code repair from the original dirty
worktree. MySQL, Redis, queues, workers, Next, ReactFlow, the Agent SDK, API
routes, persistence, SSE, and browser reloads were real. Only paid model and
media providers were replaced by local protocol-compatible HTTP services.

## Reproduced product failures

| Scenario | Reached facts | Frozen-baseline result |
| --- | --- | --- |
| Mainline repeated browser run | registration, project/episode creation, intake Choice, durable response, source-script task and `script_ready_for_review` | `PROJECT_AGENT_RUN_EVENT_STALE expectedVersion=13 actualVersion=14 expectedEventSeq=13 actualEventSeq=14`; UI reported a retained-message submission failure |
| Mainline repeated browser run | same real path under ReactFlow streaming updates | `Maximum update depth exceeded` from the ReactFlow store updater without user selection |
| Model stops after successful tool output | real streamed Agent SDK tool call and durable Choice response | product reached `assistant_failure` instead of deterministic workflow continuation |

## Independent passing controls

- The `ready_to_ingest_script` Workflow Lab checkpoint was forked through the
  production API and advanced through the real `ingest_script` Operation to
  `script_generating`.
- A model stream disconnected mid-response and produced no partial durable
  Interaction or source document.
- Two real tool calls in one streamed model response produced one durable
  pending intake Choice and no duplicate persisted tool-call identity.
- The SQL oracle account rejected a write probe.
- All browser requests to non-loopback hosts were blocked and recorded.

## Matrix result

The canonical first matrix contained one mainline plus thirteen stable
checkpoint probes. The mainline failed at the script-review response, the
`ready_to_ingest_script` probe passed, and every downstream checkpoint was
classified `blocked` because the real source journey had not durably reached
that checkpoint. A missing checkpoint is not treated as a passing or skipped
scenario.

Raw screenshots, videos, traces, logs, and database snapshots remain local in
`artifacts/golden-journey/`. The report writer appends immutable run entries;
generated artifacts are intentionally ignored by Git because they contain
ephemeral local identities and session data.

## Declared test-phase blind spots

The test-only branch does not add production fault hooks. Duplicate Outbox
delivery, late/duplicate internal SSE delivery, and failure at each handoff
transaction write boundary therefore remain explicit blind spots. Their
fault seams and executable scenarios belong to the architecture-repair phase;
until those are green, the system cannot claim architecture completion.
