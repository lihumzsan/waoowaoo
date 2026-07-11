import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseResourceRevisionTriggerStatements } from '../../../scripts/install-resource-revision-triggers'

describe('resource revision trigger installer', () => {
  it('extracts the complete named trigger set from the migration', () => {
    const sql = readFileSync(new URL(
      '../../../prisma/migrations/20260711060000_add_episode_resource_revision/migration.sql',
      import.meta.url,
    ), 'utf8')
    const triggers = parseResourceRevisionTriggerStatements(sql)

    expect(triggers).toHaveLength(40)
    expect(new Set(triggers.map((trigger) => trigger.name)).size).toBe(40)
    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'project_episode_resource_revision_update' }),
      expect.objectContaining({ name: 'panel_resource_revision_delete' }),
    ]))
  })

  it('fails explicitly when a CREATE TRIGGER statement has no quoted identity', () => {
    expect(() => parseResourceRevisionTriggerStatements(
      'CREATE TRIGGER invalid_name BEFORE UPDATE ON `table_name` FOR EACH ROW SET @x = 1;',
    )).toThrow('RESOURCE_REVISION_TRIGGER_NAME_MISSING')
  })
})
