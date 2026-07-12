# Asset scope ownership repair

## Classification and evidence

This is a class-D repair inside the System Journey incident. One ownership
invariant is missing from multiple write paths: a route authenticates the
project or user named in the request, while the asset service later mutates a
target selected only by an unrelated opaque ID. The original real browser
Journey proved the composition failure: user B authenticated with project B,
submitted project-character A's ID to the production copy route, received HTTP
200, and overwrote project A's character with B's global asset.

History shows that the unified asset service and copy route were introduced in
`f364bbc9e4`. Their source-global lookup was owner-scoped, but their target
lookup was `findUnique({id})`. Later lifecycle refactors centralized operation
execution and transactions without adding the missing asset scope authority.
No retained history scenario covered cross-project or cross-user asset IDs.

## Goal, non-goals, and prohibited paths

The goal is one service-level authority that proves the complete identity tuple
before every asset read-for-write or mutation:

`(scope, owner user, project when applicable, kind, asset ID, variant ID when applicable)`.

The repair must reject mismatched parent/child IDs before deleting, replacing,
submitting, selecting, reverting, updating, or copying any fact. A scoped miss
is reported as `NOT_FOUND`, so the boundary does not disclose whether another
owner's opaque ID exists.

This repair does not change Asset Hub product semantics, add sharing, add
recovery after intentional deletion, or create a compatibility path. Route
authentication remains necessary, but it may not substitute for target
ownership. Callers may not perform their own partial ID checks or fall back to
an unscoped lookup.

## Entry, writer, and consumer inventory

| Surface | Production entry | Current writer / effect | Required authority |
| --- | --- | --- | --- |
| read/create/update/remove | `/api/assets` and `/api/assets/[assetId]` | unified asset operations and asset service | user owns global scope; user owns project scope; asset kind and ID belong to it |
| variant update | `/api/assets/[assetId]/variants/[variantId]` | asset variant service | variant belongs to the scoped asset, not merely to some asset |
| generate/modify | asset plan and commit routes | OperationPlan, Task submitter, worker | target and child identity belong to scope before any quote/Task is created |
| select/revert/upload | render mutation routes | asset service / upload service | render or variant belongs to the scoped asset |
| copy from global | `/api/assets/[assetId]/copy` and project operation | global source plus project target overwrite | source belongs to user; target belongs to authenticated project; both kinds agree |
| legacy Asset Hub character routes | `/api/asset-hub/characters/**` | same unified operations | global character and appearance belong to current user |

The canonical persistent owner is `GlobalCharacter.userId` or
`GlobalLocation.userId` for global assets, and `Project.userId` plus the child
`projectId` for project assets. `ProjectCharacter.projectId`,
`ProjectLocation.projectId`, and each variant's parent foreign key are the only
association chains. Route body IDs, UI card IDs, and operation context alone are
not ownership facts.

## Normal, failure, retry, and concurrency sequences

Normal writes first resolve the parent scope and exact kind, then resolve the
variant under that parent when supplied, then perform the single existing
writer action. A copy validates both ends before replacing target variants.

A missing, foreign, wrong-kind, or cross-parent identity fails before any
delete, Task, quote, outbox record, billing row, storage delete, or resource
update. Duplicate submissions use the same authority and existing idempotency
rules. Late/replayed requests are re-authorized against current durable scope;
deleting a parent concurrently may make the later write fail, but may never
redirect it to another asset. Retry does not weaken scope validation.

The copy operation must use one transaction for validation, removal, recreation
and source association. Its crash result is therefore old target or complete
new target, never a target whose variants were deleted without replacement.
External storage cleanup remains best-effort where the existing product
contract already says so; it cannot change database ownership.

## Authority convergence

Before this repair, route authentication and at least nine operation-specific
raw-ID lookups competed to interpret target ownership. After the repair, one
asset scope resolver owns that conclusion and every asset mutation consumes it.
The old raw-ID-as-authority lookups and unscoped destructive deletes are
removed. The number of write entries is unchanged; the number of ownership
interpreters becomes one.

## Verification and blind spots

- The original two-user Chromium Journey must change from HTTP 200 plus foreign
  mutation to a closed response plus byte-for-byte unchanged durable target.
- The ordinary Asset Hub create/import/reload Journey must remain green.
- Real-MySQL conformance must cover global/project character, location and prop,
  including mismatched variant-parent identities and copy atomicity.
- Architecture mapping and a structural guard must prevent asset mutation code
  from bypassing the authority module.

Upload/generation provider failures are separately covered by provider/worker
Journeys. Cloud object-store ACL behavior and deliberate cross-user asset
sharing do not exist in the current product and remain outside this repair.

