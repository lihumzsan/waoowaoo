# Canvas structured-stream preview authority incident

## Classification

Architecture Incident D. The real cloud `edit_bible_generate` path kept its
durable Task processing and later completed, while Canvas promoted a transient
preview parser rejection to the node's business `failed` lifecycle. Existing
Golden Journey acceptance passed because its local model emitted each complete
JSON response in one immediate SSE chunk and the Journey observed the durable
post-terminal boundary, not the processing-time Canvas projection.

## Goal

- Parse production-planning stream items with the exact raw model contracts
  used by the production normalizers.
- Keep structured preview content subordinate to the durable Task lifecycle.
- Preserve valid incremental items without letting an invalid preview item
  declare Task or resource failure.

## Non-goals and forbidden changes

- Do not change prompts, provider routing, worker Task state, retry, billing,
  Assistant continuation, persisted production-plan schemas, or terminal
  resource refetch.
- Do not add a second preview status to Session, Task, DB, or Canvas node data.
- Do not fabricate `sourceStart/sourceEnd` in the browser. Only the production
  normalizers may derive final ranges from `sourceAnchor` or `beatId`.
- Do not hide a real Task `failed` terminal; Task terminal remains the only
  runtime failure authority.

## Entry and ownership map

| Fact | Canonical identity / scope | Owner and writer | Consumer |
| --- | --- | --- | --- |
| Raw model increment | `taskId + streamRunId + stepAttempt + stepId + lane + seq` | worker LLM stream callback | Canvas structured-stream accumulator |
| Raw production-planning item | prompt step contract | `rawEditBible*Schema` | Canvas preview adapter and server normalizer |
| Final source range | normalized bundle item identity | `normalizeRawBeatSheet`, `normalizeRawLedger`, `normalizeRawEmotionalCurve` | persistence and formal Query |
| Task processing/terminal | `Task.id + attempt` | Task service and Terminal Service | Assistant, Canvas lifecycle resolver |
| Preview items | stream identity above | browser accumulator | Canvas View only |
| Formal production plan | `ProjectEditBible.id/version` | persistence service | Query projection and Canvas final View |

Preview parse diagnostics remain local diagnostic facts. They are not a Task,
resource, or node lifecycle writer.

## Sequences

### Normal

`raw chunk -> complete raw item -> raw schema parse -> preview View -> server
normalization -> durable resource -> Task completed -> clear preview -> Query
refetch`.

### Invalid preview item

`raw chunk -> complete JSON item -> preview schema rejection -> retain local
diagnostic and skip that preview item -> Task remains processing -> later valid
items remain admissible -> terminal Task decides success/failure`.

### Duplicate, late, refresh and disconnect

Existing `streamRunId + stepAttempt + seq` admission and terminal stream
watermark remain unchanged. Refresh loses preview by design and reconstructs
only durable Task/resource facts. Late chunks after terminal remain rejected.

## Writer count

| Business conclusion | Before | After |
| --- | ---: | ---: |
| Task/resource failure writers visible to Canvas | Task/resource terminal + preview parser | Task/resource terminal only |
| Production-planning raw schema authorities | production normalizers + stale final-schema preview adapters | shared raw schemas only |

## Verification plan

- Fail-before production raw beat, ledger and emotional-cue stream items against
  the current adapters; require incremental preview entries after repair.
- Fail-before malformed preview item while Task is processing; require no
  business failure patch and continued admission of a later valid item.
- Preserve existing terminal clearing, current-attempt, duplicate and late
  stream defenses.
- Run focused stream/lifecycle tests, typecheck, Canvas guards and full
  architecture checks. `GJ-CANVAS-STRUCTURED-PREVIEW` uses a deterministic
  paced local provider and the real browser/worker/SSE path to observe a raw
  beat card while its Task is still processing, then verifies the durable
  ledger and emotional-curve cards after completion.
