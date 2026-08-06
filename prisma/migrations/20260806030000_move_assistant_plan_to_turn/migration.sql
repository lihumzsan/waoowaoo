ALTER TABLE `project_agent_turns`
  ADD COLUMN `planJson` JSON NULL;

-- Existing thread snapshots cannot be assigned to a canonical producing Turn.
-- They are stale current-state claims, so the one-way cutover intentionally
-- removes them instead of creating a dual-read or heuristic backfill.
ALTER TABLE `project_assistant_threads`
  DROP COLUMN `planJson`;
