# Free Product Hard-Cutover Design

## Decision

Waoowaoo becomes a permanently free product through a one-time hard cutover.
The legacy billing database data is intentionally deleted. There is no archive,
compatibility column, dual write, zero-price projection, or runtime fallback.

## Rollout boundary

The application and Temporal worker must be stopped before applying
`20260811130000_remove_billing_schema`. The deployment process applies that
migration, verifies the removed tables and columns through `information_schema`,
regenerates Prisma, and only then starts the new application version. There is
no down migration because the user explicitly chose permanent deletion.

## Execution authority

All planned operations use one lifecycle:

```text
Operation Plan -> PlanSnapshot -> OperationExecution -> Task/Resource -> provider -> terminal projection
```

`OperationExecution` is uniquely identified by `planSnapshotId + requestId`.
For `confirmation.kind === "none"`, the PlanSnapshot is the sole execution
authority and an execution is created directly. For `confirmation.kind ===
"destructive"`, an `ApprovalGrant` remains an input-bound authorization proof,
but never supplies execution identity or a second execution path.

The API, Canvas, and MCP call the same planned-operation dispatcher. The Canvas
starts free generation immediately after plan persistence. Its confirmation
modal is reserved for destructive operations.

## Free-product boundary

The active product has no billing, price, quote, balance, settlement, payment,
or credit state. This includes API response fields, prompt templates, legal
copy, configuration UI, test bootstrap names, and no-op compatibility helpers.
Provider-account billing errors remain provider availability facts and do not
create local billing state.

`check:free-product-contract` validates active source, message, prompt, and
package-script surfaces with narrow allowlists only for upstream provider error
classification and historical migration audit files. `free-product.md` is the
sole active architecture contract; the retired billing document is not indexed.

## Sound contract

Environmental sound keeps the previously repaired MOSS graph, explicit
`audioKind`, node-28 single-MP3 output check, and HTTP rejection classification.
Both initial requests and retry payloads validate that `negativePrompt` is
nonblank without trimming or otherwise changing its bytes.

## Verification

The implementation proves direct free execution with the real operation
planning/persistence path, proves destructive approval remains mandatory,
checks raw negative-prompt preservation, runs the free-product guard, typecheck
and production build. The database cleanup is validated against the actual
schema only after the authorized destructive migration runs. A live ComfyUI
sound generation remains a separately reported environment verification when a
reachable compatible ComfyUI instance is available.
