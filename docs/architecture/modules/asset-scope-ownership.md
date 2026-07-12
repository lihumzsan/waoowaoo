<!-- architecture-module: asset-scope-ownership -->

# Asset scope ownership

## Design

An asset identity is not an ID alone. Every asset read-for-write and mutation
must resolve one canonical tuple: scope, owning user, project when present,
asset kind, asset ID, and variant ID when present. Authentication proves who is
calling; the asset authority proves what that caller may mutate.

## Invariants

- **ASO-01 — Scoped identity is indivisible.** A global asset must belong to the
  authenticated user. A project asset must belong to the authenticated project,
  whose owner is that user. Kind must match the persisted asset kind.
- **ASO-02 — Child identity never floats.** An appearance, image, or render ID
  is valid only when it belongs to the supplied scoped parent asset.
- **ASO-03 — The service is the authority.** Route/project authentication is a
  prerequisite, not proof of asset ownership. Every mutation, plan and
  read-for-write consumes the shared asset scope resolver.
- **ASO-04 — Scoped misses fail without disclosure.** Missing, foreign,
  wrong-kind and cross-parent targets fail as `NOT_FOUND` before side effects.
- **ASO-05 — Copy validates both ends atomically.** Global source and project
  target are authorized before replacement; validation, replacement and source
  association share one transaction.
- **ASO-06 — Deletion cannot use a raw opaque ID.** Destructive asset deletion
  executes only after the same scoped identity proof as update/select/revert.

## Authority

- Identity and ownership resolver:
  `src/lib/assets/services/asset-scope-ownership.ts`.
- Asset mutation owner: `src/lib/assets/services/asset-actions.ts`.
- API/operation entries: unified asset routes and
  `src/lib/operations/api-only/assets-api-ops.ts`.
- Persistent owner facts: global asset `userId`, project `userId`, asset
  `projectId`, and variant parent foreign keys.

## Verification

- `GJ-ASSET-HUB-CROSS-PROJECT-DENIAL` proves a second authenticated user cannot
  overwrite another project asset through the real copy route.
- `GJ-ASSET-HUB-PROJECT-REUSE` proves the ordinary source/target UI path and
  durable source identity still work.
- Asset scope conformance uses real MySQL to cover all registered kinds and
  parent/variant relations.
- The asset-scope authority guard rejects new raw-ID mutation paths in the
  unified service.

