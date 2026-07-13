# Parallel Image Batch Generation Design

## Summary

Image batches currently run as one BullMQ job whose handler generates every image with a serial `for`/`await` loop. A slow or timed-out image blocks the rest of the batch, and a retry restarts the whole job. The image worker is also configured with local concurrency `1`, so unrelated image work waits behind the batch.

Change batch generation so that every image is an independent BullMQ job. Limit the `waoowaoo-image` queue to 10 active jobs globally, retain the existing per-user concurrency gate, and set the current user's image concurrency to 10. Aggregate child task state by batch for the existing asset cards.

## Goals

- Run up to 10 image generations concurrently across all workers and users.
- Make each image independently retryable and persist successful images immediately.
- Show truthful batch progress such as `1/3`, `2/3`, and `3/3`.
- Preserve existing single-image generation behavior.
- Prevent an old or canceled batch from overwriting a newer batch.
- Keep the global limit correct if more image worker processes are added later.

## Non-goals

- Changing Codex prompts, models, image size enforcement, or provider selection.
- Adding provider-specific rate-limit scheduling.
- Redesigning unrelated text, voice, or video queues.
- Automatically raising every future user's personal image concurrency to 10.

## Considered Approaches

### 1. Unbounded `Promise.all` inside the existing batch job

This is the smallest code change, but BullMQ would see one active job while the handler starts several real image calls. It would bypass queue-level and per-user concurrency accounting. A failed child would also retain the current whole-batch retry behavior.

Rejected.

### 2. Bounded concurrency inside the existing batch job

Using `mapWithConcurrency` would limit each batch, but total concurrency would be the number of active batch jobs multiplied by each batch's internal limit. The queue would still be unable to retry or report each image independently, and partial-success persistence would require new checkpoint logic.

Rejected.

### 3. One BullMQ task per image

Expand a batch request into independent single-image jobs and aggregate their state using shared batch metadata. BullMQ controls real work, successful images persist immediately, and retries affect only failed images.

Selected.

## Architecture

### Batch submission

Introduce a shared batch submission service used by project character and location generation routes. It will:

1. Resolve and validate the requested image count.
2. Ensure location image slots exist before submitting jobs.
3. Generate one `batchId` and, for regeneration, one batch-level regeneration token.
4. Submit one existing image task per index with `count: 1` and an explicit `imageIndex`.
5. Return the first task as `taskId` for backward compatibility, plus `taskIds` and `batchId`.

Each child payload will contain:

```ts
batch: {
  id: string
  index: number
  total: number
}
```

The child tasks retain the existing task types:

- `image_character` for character images.
- `image_location` for location and prop images.

All children use the existing group-level `targetType` and `targetId`. This lets current asset cards keep querying one target while the target-state service aggregates the latest batch.

Each child dedupe key includes the task type, target, image index, and regeneration token when present. Duplicate submissions without a new regeneration token reuse the active child task instead of creating duplicate image calls.

### Worker execution

The existing character and location handlers will continue supporting group-shaped legacy jobs, but all new API submissions will create single-image jobs. The single-image path generates and persists exactly one index.

This compatibility path allows jobs already queued before deployment to finish without migration. Once no legacy batch jobs remain, the serial group branches can be removed in a separate cleanup.

### Global and per-user concurrency

Set the image worker's local concurrency to 10 and configure BullMQ global concurrency for `waoowaoo-image` to 10 using `Queue.setGlobalConcurrency(10)` during worker startup.

The BullMQ global setting is authoritative across multiple worker processes. Local worker concurrency prevents a single worker from starting more than 10 jobs, while BullMQ prevents the combined workers from exceeding 10.

Keep the existing per-user concurrency gate around each image job. Effective user concurrency is:

```text
min(user image concurrency, global image concurrency)
```

For the current single user, set the existing `imageConcurrency` preference to 10 through the configuration service or configuration UI. Future users retain their own configured limit and cannot exceed the global limit.

### Batch state aggregation

Extend `TaskTargetState` with optional batch information:

```ts
batch: {
  id: string
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  failedIndexes: number[]
} | null
```

For a target whose newest tasks contain batch metadata, the target-state service will select the latest `batchId` and aggregate only tasks from that batch:

- If any child is processing, phase is `processing`.
- Otherwise, if any child is queued, phase is `queued`.
- When every child is terminal and none failed or was canceled, phase is `completed`.
- When every child is terminal and at least one failed or was canceled, phase is `failed` while successful images remain available.
- Progress is the average child progress, with completed children counted as 100.
- The displayed count uses `completed / total`.
- `lastError` comes from the most recently updated failed child.

Tasks without batch metadata continue through the existing target-state resolution unchanged.

SSE events already invalidate target state. Each child completion therefore refreshes the aggregate and exposes newly persisted images without waiting for the full batch.

## Supersession and Stale-Write Protection

Starting a replacement batch for a target must supersede older active batch children for the same task type and target:

1. Mark older active children canceled using the existing task lifecycle service.
2. Remove their waiting or delayed BullMQ jobs where possible.
3. Let an already running provider call finish, but require `assertTaskActive` immediately before persistence.

This prevents results from an older batch from overwriting a newer regeneration. The new batch may start as soon as a global slot is available; it does not wait for canceled provider calls to return.

## Failure and Retry Semantics

- BullMQ retries each failed image independently using the existing attempt and backoff policy.
- A successful child is never rerun because another child failed.
- Successful images remain stored and visible when the batch is partially failed.
- The UI exposes a retry action for `failedIndexes`; it submits a new batch containing only those indexes.
- A Codex timeout consumes only the affected child's attempt.
- Canceling or superseding a task prevents persistence even if its provider process returns later.

Billing and usage settlement remain child-task scoped. Each image job freezes, settles, or releases only its own image cost. Existing task-level idempotency keys must include the child index.

## API Compatibility

Batch submission responses become:

```json
{
  "success": true,
  "async": true,
  "taskId": "first-child-task-id",
  "taskIds": ["child-1", "child-2", "child-3"],
  "batchId": "batch-id",
  "status": "queued"
}
```

Existing clients that read only `taskId`, `async`, and `status` continue to work. New UI logic may use `batchId` and `taskIds` for diagnostics and targeted cancellation.

Single-image requests may use the same response shape with one task, but they do not require batch aggregation.

## Configuration and Deployment

- Set `QUEUE_CONCURRENCY_IMAGE=10`.
- Add `IMAGE_QUEUE_GLOBAL_CONCURRENCY=10`, defaulting to 10 when absent.
- On worker startup, validate the value as a positive integer and call `imageQueue.setGlobalConcurrency(value)` before accepting work.
- Set the current user's `imageConcurrency` preference to 10.
- Log the effective local, global, and user limits at worker startup without logging credentials.

Deploy the API and worker code together. The worker retains legacy batch handling, so in-flight serial jobs remain valid. Do not manually rewrite active task payloads.

## Testing

### Unit tests

- Batch submission creates one child task per requested index with a shared `batchId`.
- Child dedupe keys differ by index and regeneration token.
- Character and location child handlers generate and persist only their assigned index.
- Target-state aggregation covers queued, mixed active, completed, partial failure, and legacy non-batch states.
- Superseding a batch cancels older children and prevents stale persistence.
- Invalid concurrency values fall back safely and never produce zero or unlimited concurrency.

### Integration tests

- Submit three images and verify three jobs become active when capacity is available.
- Verify a global limit of 10 with more than 10 queued image jobs.
- Verify the global limit across two worker instances.
- Force one of three children to time out and confirm only that child retries.
- Confirm successful siblings persist and remain visible during the retry.
- Start a replacement batch and confirm the older running child cannot overwrite it.
- Verify billing is settled once per successful child and released or retried correctly for failures.

### UI behavior tests

- Progress advances from `0/3` to `1/3`, `2/3`, and `3/3` as child tasks finish.
- Partial failure shows retained successful images and the failed count.
- Retrying failed indexes does not regenerate successful indexes.
- Existing single-image generation and regeneration controls remain unchanged.

## Acceptance Criteria

- No more than 10 image jobs are active globally, including with multiple worker processes.
- With available capacity, all images in a three-image batch start without waiting for one another.
- A single failed image does not rerun successful siblings.
- Each successful image becomes visible before the full batch completes.
- A newer batch cannot be overwritten by results from a superseded batch.
- Legacy queued batch jobs and single-image jobs continue to execute successfully.
