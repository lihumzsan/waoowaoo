import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const OLD_WORKFLOW = 'basevideo/ltx23-profiles/t8-smooth-first-last-frame'
const NEW_WORKFLOW = 'basevideo/ltx23-profiles/goon-first-last-frame-2stage'

describe('Goon first/last-frame model migration', () => {
  it('migrates every mutable saved model location without rewriting audit history', () => {
    const migrationPath = join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260712150000_migrate_smooth_first_last_frame_to_goon',
      'migration.sql',
    )

    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf-8')

    expect(sql).toContain('UPDATE `novel_promotion_projects`')
    expect(sql).toContain('UPDATE `novel_promotion_panels`')
    expect(sql).toContain('UPDATE `user_preferences`')
    expect(sql).toContain('`customModels`')
    expect(sql).toContain('`capabilityDefaults`')
    expect(sql).toContain('`capabilityOverrides`')
    expect(sql).toContain(OLD_WORKFLOW)
    expect(sql).toContain(NEW_WORKFLOW)

    expect(sql).not.toMatch(/UPDATE\s+`?(?:tasks|task_events|graph_runs)`?/i)
    expect(sql).not.toMatch(/DELETE\s+FROM/i)
  })

  it('uses the target columns collation for workflow session variables', () => {
    const migrationPath = join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260712150000_migrate_smooth_first_last_frame_to_goon',
      'migration.sql',
    )
    const sql = readFileSync(migrationPath, 'utf-8')

    expect(sql).toMatch(
      /SET @old_workflow = _utf8mb4'.*?' COLLATE utf8mb4_unicode_ci;/,
    )
    expect(sql).toMatch(
      /SET @new_workflow = _utf8mb4'.*?' COLLATE utf8mb4_unicode_ci;/,
    )
  })
})
