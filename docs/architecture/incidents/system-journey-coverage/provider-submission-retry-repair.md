# Provider submission retry authority repair

## Classification and evidence

This is a class-D corrective change under the System Journey Coverage incident.
The real `GJ-WORKER-RETRY-RECOVERY` journey sent a production video submission
through the real UI, Approval, Task, Redis queue, worker and OpenRouter adapter.
The controlled provider returned HTTP 503 before accepting a job. The durable
provider fence stored the response as permanent `rejected`, emitted
`PROVIDER_SUBMISSION_REJECTED`, and prevented the Task's configured second
attempt. The Journey therefore proved that retry configuration existed but the
submission owner made it unreachable.

Historical triage found the same retry-authority invariant in the changes that
introduced unified Task retry and the durable provider fence. The earlier
defense correctly prevented ambiguous network outcomes from being resubmitted,
but classified every explicit non-2xx `FetchStatusError` as permanent. Isolated
tests covered result replay, concurrent claims and ambiguous disconnects; none
executed an explicit transient rejection through a later durable Task attempt.

Impacted architecture modules are `async-task-lifecycle`, `provider-gateway`
and `billing-approval`. `npm run architecture:impact` was run for the provider
invocation owner, provider adapter, error catalog and worker retry owner before
this design was written.

## Goal

Make the durable provider invocation checkpoint the only authority that decides
whether a provider POST may be issued, while allowing a newer durable Task
attempt to retry only when the provider explicitly proved that it did not
accept the previous submission.

## Non-goals and prohibited changes

- Do not add an automatic retry inside provider submit adapters or
  `fetchWithRetry`; provider-submit policy remains one HTTP attempt per admitted
  durable claim.
- Do not resubmit after timeout, disconnect, parse failure after a successful
  response, process death during submission, or any other ambiguous outcome.
- Do not infer acceptance from error text. Only the typed HTTP status and a
  successful provider result/identity participate in this contract.
- Do not change Task attempt limits, backoff, billing settlement, AI-driven
  workflow continuation, or provider polling ownership.
- Do not introduce a second retry loop or a provider-specific exception branch.

## Authority and identity

| Fact | Canonical identity | Unique owner/writer | Consumers |
| --- | --- | --- | --- |
| Durable Task attempt | `Task.id + Task.attempt` | Task claim/terminal lifecycle | worker, provider invocation fence |
| Logical provider submission | `Task.id + invocationKey + request fingerprint` | `executeTaskDurableInvocation` checkpoint | media/LLM execution adapters |
| Permission to issue one provider POST | checkpoint state plus admitted `taskAttempt` | atomic checkpoint claim/reclaim | provider execution callback |
| Provider acceptance | stored `submitted` result including provider identity | checkpoint transition after parsed success | Task handler replay |
| Retry classification | typed error catalog plus explicit HTTP status class | provider invocation fence, then Task retry policy | worker/BullMQ |

The invocation key and request fingerprint do not change across Task attempts.
`taskAttempt` is a fencing version, not a new external invocation identity.

## Exhaustive lifecycle

1. **First submission:** the current Task attempt creates `submitting` and is
   the only caller allowed to issue the POST.
2. **Accepted:** a valid success becomes `submitted`; every replay returns the
   stored result without another POST.
3. **Permanent explicit rejection:** HTTP statuses outside the admitted
   transient set, or a parsed provider business rejection, become `rejected`;
   all later attempts replay the permanent failure.
4. **Transient explicit non-acceptance:** HTTP 408, 425, 429, 500, 502, 503 or
   504 becomes `retryable_rejected`, stamped with the Task attempt that made the
   request. The current attempt receives retryable `PROVIDER_SUBMIT_FAILED`.
5. **Same-attempt replay:** cannot issue another POST and receives the same
   retryable failure.
6. **Newer Task attempt:** atomically changes `retryable_rejected` to
   `submitting` with its higher attempt number. Exactly the winner may issue one
   POST. A concurrent loser cannot submit.
7. **Ambiguous outcome:** network exception, timeout, process interruption, or
   failed checkpoint settlement becomes or is treated as `outcome_unknown`;
   no current or future attempt may resubmit.
8. **Late/replayed caller:** a caller with an equal or older attempt can never
   reclaim a newer checkpoint.
9. **Provider polling:** starts only after `submitted` has stored the external
   identity and remains governed by the separate poll/reconcile contract.
10. **Task terminal and billing:** remain downstream of the stored provider
    result and retain their existing attempt/settlement fences.

An explicit non-2xx submission response is treated as non-acceptance because
the provider contract creates an external execution identity only in its
successful response. If an adapter cannot make that guarantee, it must not
surface the failure as `FetchStatusError`; it must surface an ambiguous outcome.

## Transaction, crash and concurrency boundaries

- Initial claim and newer-attempt reclaim are single conditional database
  writes. No provider call occurs before the winning write commits.
- The external POST and checkpoint success cannot share one transaction. A
  crash between them is deliberately fail-closed as `outcome_unknown` rather
  than risking duplicate paid work.
- The transient response is stored before the retryable AppError is emitted.
  If that storage fails, the outcome is treated as unknown, not retryable.
- BullMQ remains the only retry scheduler. The checkpoint only grants or denies
  the next Task attempt's right to submit.

## Authority-count change and deletion

Before: Task policy said transient provider failures retry, while the provider
fence independently converted every typed HTTP rejection to permanent. Two
competing interpretations existed and the permanent one always won.

After: the provider fence records the exact submission outcome; the shared
error catalog maps that outcome to the existing Task retry class; BullMQ only
schedules the already-authorized next attempt. There is one submission writer,
one retry scheduler and one durable attempt fence. The blanket
`FetchStatusError -> rejected` interpretation is deleted; no compatibility
branch or internal submit retry is added.

## Verification plan and blind spots

The real-MySQL provider invocation integration must prove:

- transient 503 is stored before retry, cannot resubmit in the same attempt,
  can be claimed exactly once by attempt two, and replays its success;
- permanent 422 remains rejected across later attempts;
- timeout/disconnect remains outcome-unknown with zero resubmission;
- existing concurrent-first-claim and accepted-result replay remain green.

The original Playwright worker-retry Journey must then prove through the real
browser/Approval/Task/Redis/worker/provider path that one Task reaches attempt
two and completes with one durable operation effect and no failed duplicate.
The terminal-provider-failure Journey must remain green. External providers may
violate the documented non-2xx/non-acceptance contract; that remains an external
protocol blind spot and must be handled per adapter, never guessed from text.

