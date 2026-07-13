ALTER TABLE `operation_plan_snapshots`
  DROP INDEX `operation_plan_snapshots_expiresAt_idx`,
  DROP COLUMN `expiresAt`;

ALTER TABLE `approval_grants`
  DROP INDEX `approval_grants_expiresAt_idx`,
  DROP COLUMN `expiresAt`;
