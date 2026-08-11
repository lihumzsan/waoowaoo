<!-- architecture-module: free-product -->

# Free product boundary

Waoowaoo is a free product. Billing, payment, balance, quote, settlement, and
retail-price state are not part of the active product contract and must not be
reintroduced as a second authority through a merge.

## Invariants

- **FP-01 — No billing owner:** active production code has no billing/payment
  service, ledger writer, price authority, balance gate, or payment route.
- **FP-02 — One execution lifecycle:** non-destructive work follows the single
  Operation Plan → snapshot → Operation Execution → Task/Resource → provider →
  terminal projection lifecycle. Free execution does not create a quote or
  charge fact.
- **FP-03 — Destructive safety remains:** destructive operations still require
  an input-bound confirmation/grant; removing payment must not remove deletion
  safety or canonical identity checks.
- **FP-04 — Schema cleanup is explicit:** historical migrations remain audit
  history. Removal of legacy billing tables and columns is represented by the
  dedicated unapplied cleanup migration and is never performed implicitly by
  application startup.
- **FP-05 — Merge guard:** `check:free-product-contract` is the executable
  boundary. A merge that restores forbidden active paths, dependencies, package
  scripts, schema facts, or billing imports must fail the guard.

## Authority and verification

Operation planning/task submission remains owned by the operations and task
modules. The free-product module owns only the absence-of-billing boundary and
the guard that enforces it; it does not create a parallel task state machine or
execution writer.
