# Native Runtime Compaction V2 Design

## Problem

The workspace assistant uses the installed Codex App Server with the user's native ChatGPT authentication. Long threads automatically compact their history. The Wao runtime contract still forces `remote_compaction_v2` off, a setting retained from the deleted custom Responses gateway. With Codex CLI `0.147.0-alpha.6.6`, the long-thread compaction path then calls the legacy ChatGPT compact endpoint and receives `404 Not Found`, which fails the entire Product Turn.

## Scope

- Enable the stable native remote-compaction-v2 capability in the one assistant runtime static contract.
- Add a pure contract regression that fails if the native runtime is configured to use the legacy compaction path again.
- Restore the already-defined `reportTaskRetry` Activity in the Worker export registry and make the Worker registry conform to `TaskWorkflowActivities` at compile time.
- Preserve the existing Product Turn failure projection and “continue unfinished task” admission path.
- Verify from the real workspace UI by clicking “继续未完成任务” after the live service consumes the change.

## Non-goals

- Do not rewrite or delete the failed Turn or its assistant message.
- Do not replay completed media operations.
- Do not change task retry policy, persistence writers, context limits, compaction prompts, or UI copy.
- Do not combine the separate SSE resync repair with this commit.

## Design

`ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.remoteCompactionV2` remains the single declaration consumed by both `thread/start` and `thread/resume`. Change its value to `true`; do not add an environment override or fallback. A unit test imports the production contract and asserts that a native-authenticated runtime selects v2 compaction. This is a registry-style contract oracle: changing the declaration back to `false` must fail before a long live conversation reaches the obsolete endpoint.

The existing failed Turn stays terminal. UI recovery creates a new Product Turn with a new message-command identity, asks the assistant to reconcile durable project and task facts, and therefore does not reopen or replay the failed source Turn.

Live pre-integration inspection found that the final media Task could not become terminal: its Workflow had a pending `reportTaskRetry` Activity, while the Worker module export registry omitted the already-implemented Activity. The Activity had retried 157 times with `NotFoundError`. Add the missing export and bind the Worker activity namespace to `TaskWorkflowActivities` as a compile-time conformance guard. This completes the existing lifecycle path; it does not add another writer or alter retry semantics.

## Verification

1. Observe the new contract test fail while the production value is `false`.
2. Change the production contract to `true` and observe the test pass.
3. Add the Worker registry type conformance and observe typecheck fail while `reportTaskRetry` is absent, then export the Activity and observe typecheck pass.
4. Run targeted ESLint, the required logic suite, and architecture impact routing.
5. Reload the Worker so the pending Activity can complete, then wait until the existing media task is terminal.
6. In the workspace UI, click “继续未完成任务” once. Confirm the new Turn completes, no new compaction 404 is persisted, and completed media task counts do not regress or duplicate.
