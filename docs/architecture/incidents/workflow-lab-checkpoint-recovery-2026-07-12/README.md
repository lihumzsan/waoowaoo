# Workflow Lab checkpoint recovery incident (2026-07-12)

## Classification

Architecture Incident (D). The default Golden mainline completed, while five
real Workflow Lab/checkpoint combinations failed after earlier checkpoint
coverage had passed narrower paths.

## Goal and boundaries

Restore one meaning for a Workflow Lab checkpoint: the forked project's
durable domain facts, Assistant history, and visible workflow stage must all
describe the selected historical boundary, and the next real UI action must be
able to advance it.

This change does not alter the production workflow resolver, Assistant run
lifecycle, provider protocol, or default mainline. The only production writer
in scope remains `forkWorkflowLabCheckpointProject`; Golden code only selects
and exercises checkpoints through the production Workflow Lab route.

## Owners and entry points

| Concern | Canonical identity / scope | Unique owner / writer | Consumer |
| --- | --- | --- | --- |
| Checkpoint | checkpoint id + source episode | `listWorkflowLabCheckpointsFromMessages` | Workflow Lab list/fork route |
| Forked domain state | target project + episode | `forkWorkflowLabCheckpointProject` transaction | workflow resolver, UI |
| Stage projection | selected `EditFirstWorkflowStage` | `clone-stage.ts` policies used by clone modules | domain clone writers |
| Golden source | stage -> immutable project/episode scope | source fixture manifest | downstream staircase and probes |

## Failure and recovery model

- Normal: list a historical checkpoint, fork transactionally, resolve exactly
  the selected stage, then advance through the real UI.
- Missing checkpoint: fail closed; do not silently use another source.
- Duplicate/retry: each fork has a new project identity; the source remains
  immutable and may be forked repeatedly.
- Late source progress: stage-specific manifest entries win over the mutable
  staircase cursor.
- Future facts: Bible lock, Asset requirement outcome, storyboard images,
  videos, and chapter-render output are projected according to the selected stage; a frozen Asset
  Approval keeps its stale-value target association while resetting its future
  completion/error outcome.
- Approval recovery: a durable zero-Task Approval remains forkable because its
  atomic commit may still apply operation-specific plan writes and resolves as
  noop without manufacturing Task rows.
- Refresh/disconnect: the fork contains durable facts and is reopened through
  the normal workspace route.
- Input-required recovery: if an early stage cannot execute without a user
  decision, the Assistant may raise its real Choice and Golden submits it
  through the UI; the harness does not invent a domain write.

## Transactions, idempotency, and deletion

The existing single Prisma transaction remains the only fork writer. No new
writer, protocol, fallback, timer, or compatibility branch is introduced.
This removes two invalid interpretations: copying current source facts as if
they belonged to an earlier stage, and treating the mutable latest staircase
scope as the source for every historical checkpoint.

Writer count remains one. Competing checkpoint-source interpretations reduce
from two (`scope` versus `checkpointSources`) to one stage-specific resolver
with `scope` only as the initial fallback.

## Verification and blind spots

Pre-fix evidence is the 2026-07-12 discovery run at commit `f96109502`: 9
passed, 5 failed, and 4 dependency-blocked. Focused post-fix runs covered the
five failed scenario identities, the default Mainline, and the zero-Task
Approval contract. Provider failure and browser-disconnect variants are
recorded separately because they also exercise Assistant continuation policy.
