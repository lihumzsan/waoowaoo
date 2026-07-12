# Retained test asset audit

## Current inventory

The reset baseline already removed the bulk of the old self-proving suite. The
current physical inventory at this discovery point is:

| Directory | Files | Interpretation |
| --- | ---: | --- |
| `tests/unit` | 97 | Admitted logic specifications plus a small Assistant fixture residue; the added Workflow Lab specification protects canonical interruption/plan identity algorithms that repeatedly failed real Journeys |
| `tests/integration` | 43 | Provider contracts and critical real-infrastructure Task/Billing scenarios; includes the new real worker-context and provider-retry defenses |
| `tests/system` | 0 | Retired as a directory-level completeness authority |
| `tests/regression` | 0 | Synthetic regression authority retired; history lives in incidents linked to real scenarios |
| `tests/contracts` | 3 | Exhaustive production registry conformance |
| `tests/golden-journey` | 58 | Browser journeys, protocol providers, oracle, runtime and harness self-tests; file count is not a target |

## Mock audit

Only six files under retained Unit/Integration paths contain `vi.mock` or
`jest.mock`:

- two provider fixture files replace external runtime configuration or outbound
  transport at the provider contract boundary; these are admitted substitutes;
- three Assistant fixture files and one interruption-consumption specification
  replace internal persistence/event/session layers. They are not accepted as
  browser product proof. They remain temporarily because the separate active
  Assistant lifecycle Goal owns the same contracts and files; deleting or
  rewriting them here would violate worktree ownership. They must be reassessed
  after that Goal integrates.

No retained test was deleted merely because it contains a mock. The governing
question is whether the mock removes the layer where the asserted bug can
exist.

The full checkpoint discovery added one logic file with six cases rather than
one test per stage. It rejects ambiguous interruption identity, missing Approval
runState, invisible pending durable Approval, plan-only identity reuse and
asset-association loss. The independent browser matrix remains the product
oracle; these cases only protect the non-trivial pure mapping rules exposed by
the browser failures.

## Source and call-count audit

No retained test asserts production TypeScript source strings. Two migration
tests read their SQL migration file, install it into an isolated real MySQL
schema, and assert the resulting columns/indexes or retired tables; they test
the executable migration artifact and are retained as Critical Infrastructure.

Several retained tests use `toHaveBeenCalledWith` as a secondary assertion.
That token alone is not a deletion rule. A test is inadmissible only when call
count/arguments are its final oracle and no algorithm, transaction, protocol,
user result, or durable fact is asserted. No new batch deletion is justified
without that per-file proof.

## Next deletion gate

After the Assistant lifecycle Goal is integrated:

1. re-run this audit on the four internal-mock Assistant files;
2. retain only pure reducer/state-machine/serialization contracts;
3. move persistence, interruption consumption and session reconstruction proof
   to real MySQL/Run/Choice/Approval Journey or Critical Infrastructure paths;
4. delete any fixture whose only purpose is to reproduce the production
   implementation with configured return values.
