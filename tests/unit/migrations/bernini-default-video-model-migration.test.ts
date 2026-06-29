import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const OLD_DEFAULT = 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2'
const NEW_DEFAULT = 'comfyui::basevideo/seedance2/bernini-480p-i2v'

describe('Bernini default video model migration', () => {
  it('migrates only saved old default video model values', () => {
    const migrationPath = join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260613120000_migrate_default_video_model_to_bernini',
      'migration.sql',
    )

    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf-8')

    expect(sql).toContain('UPDATE `user_preferences`')
    expect(sql).toContain('UPDATE `novel_promotion_projects`')
    expect(sql).toContain(`SET \`videoModel\` = '${NEW_DEFAULT}'`)
    expect(sql).toContain(`WHERE \`videoModel\` = '${OLD_DEFAULT}'`)
    expect(sql).not.toContain('LIKE')
  })

  it('adds a panel-level video model column for per-panel workflow persistence', () => {
    const migrationPath = join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260628120000_add_panel_video_model',
      'migration.sql',
    )

    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf-8')

    expect(sql).toContain('ALTER TABLE `novel_promotion_panels`')
    expect(sql).toContain('ADD COLUMN `videoModel` LONGTEXT NULL')
  })
})
