# Historical regression matrix

| Historical symptom | Root cause | Earlier repair | Existing defense | Recurrence / defense gap |
| --- | --- | --- | --- | --- |
| Forked Choice/Approval lacked resumable runtime identity | UI-shaped history was copied without durable interruption/run state | `c65f13a29` restored real run/activity records | Workflow Lab checkpoint tests | Did not cover later domain facts leaking into earlier stage forks |
| Durable Approval fork lost rewritten identities | plan, runState, and domain ids were not rewritten as one graph | `2fdc5b8c6` added clone maps and durable checkpoint cloning | Golden stage probes and logic checks | Clone policies rewrote ids but copied several future lifecycle facts unchanged |
| Downstream staircase could not find a checkpoint already present in an earlier source | mutable latest scope was treated as every checkpoint's source | stage-source manifest was introduced in `2849f2b8b` | downstream discovery | consumer ignored the stage-specific map it wrote |
| Early stage probe remained awaiting intake Choice | recovered stage legitimately re-raised required user input | none | real browser probe | harness forced an operation but never consumed the real Choice |
| Earlier fork resolved past Assets or Storyboard Images | generated targets/media from the completed source survived rewind | none | exact-stage assertion | target-stage projection did not own all lifecycle-bearing fields |
| Assets Approval clone failed with `OPERATION_PLAN_TASK_IDENTITIES_INVALID` | approved-plan submitter conflated a legal zero-Task noop with duplicate Task identity corruption | none | `operationMayCompleteWithoutTasks` and atomic plan commit | invocation allowed noop but the unique Task submitter rejected it before operation-specific plan writes could commit |
| Video completion fork skipped directly to audio generation | completed chapter render status and output media survived rewind to `ready_to_generate_videos` | none | task-disconnect Journey exact-stage assertion | chapter render outcome was not included in the target-stage projection policy |
