# Native Runtime Local Compaction Design

## Problem

The workspace assistant uses the installed Codex App Server with the user's native ChatGPT authentication. Long threads automatically compact their history. The first repair assumed that enabling `remote_compaction_v2` alone would select the supported route. UI verification after that change falsified the assumption: compaction still called the legacy ChatGPT endpoint and received `404 Not Found`, failing the Product Turn.

Pinned Codex `0.147.0-alpha.6.6` selects remote versus local compaction from provider identity, not from the v2 feature flag. A provider named exactly `OpenAI` uses remote compaction, while native ChatGPT authentication remains available for a provider without an explicit base URL when it declares `requires_openai_auth`. The repair must therefore declare one non-`OpenAI` provider identity that keeps the native Responses service and selects local compaction.

## Scope

- Declare one native-authenticated local-compaction model provider in the one assistant runtime static contract.
- Emit that provider as the sole `model_provider` and matching `model_providers` entry in the single runtime config builder.
- Add a pure contract regression that fails if the provider identity required for local compaction is removed.
- Restore the already-defined `reportTaskRetry` Activity in the Worker export registry and make the Worker registry conform to `TaskWorkflowActivities` at compile time.
- Preserve the existing Product Turn failure projection and “continue unfinished task” admission path.
- Verify from the real workspace UI by clicking “继续未完成任务” after the live service consumes the change.

## Non-goals

- Do not rewrite or delete the failed Turn or its assistant message.
- Do not replay completed media operations.
- Do not change task retry policy, persistence writers, context limits, compaction prompts, or UI copy.
- Do not combine the separate SSE resync repair with this commit.

## Design

`ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.modelProvider` is the single provider declaration consumed by both `thread/start` and `thread/resume` through `runtimeConfig`. It has the stable ID `wao-openai-local-compaction`, a deliberately non-`OpenAI` name, native OpenAI authentication, WebSocket support, and standalone web-search support. `runtimeConfig` emits its ID as `model_provider` and exactly one matching entry under `model_providers`; it omits `base_url`, `env_key`, and bearer credentials so the existing desktop ChatGPT login remains authoritative. Remove `remoteCompactionV2` and `remote_compaction_v2`: they do not own this routing decision. A unit test imports the production contract and asserts this provider registry entry, so deleting it fails before a long live conversation reaches the obsolete endpoint.

The existing failed Turn stays terminal. UI recovery creates a new Product Turn with a new message-command identity, asks the assistant to reconcile durable project and task facts, and therefore does not reopen or replay the failed source Turn.

Live pre-integration inspection found that the final media Task could not become terminal: its Workflow had a pending `reportTaskRetry` Activity, while the Worker module export registry omitted the already-implemented Activity. The Activity had retried 157 times with `NotFoundError`. Add the missing export and bind the Worker activity namespace to `TaskWorkflowActivities` as a compile-time conformance guard. This completes the existing lifecycle path; it does not add another writer or alter retry semantics.

## Verification

1. Observe the provider-contract test fail while the production provider declaration is absent.
2. Add the native-authenticated local-compaction provider and observe the test pass.
3. Add the Worker registry type conformance and observe typecheck fail while `reportTaskRetry` is absent, then export the Activity and observe typecheck pass.
4. Run targeted ESLint, the required logic suite, and architecture impact routing.
5. Reload the Worker so the pending Activity can complete, then wait until the existing media task is terminal.
6. In the workspace UI, click “继续未完成任务” once. Confirm the new Turn completes, no new compaction 404 is persisted, and completed media task counts do not regress or duplicate.
