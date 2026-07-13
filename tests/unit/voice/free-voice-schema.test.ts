import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('free voice Prisma contract', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
  const migrationPath = 'prisma/migrations/20260713090000_add_project_free_voice/migration.sql'

  it('defines project records, unique versions, and cascading ownership', () => {
    expect(schema).toContain('model NovelPromotionFreeVoiceRecord')
    expect(schema).toContain('model NovelPromotionFreeVoiceVersion')
    expect(schema).toContain('@@unique([recordId, versionNumber])')
    expect(fs.existsSync(migrationPath)).toBe(true)
    const migration = fs.readFileSync(migrationPath, 'utf8')
    expect(migration).toContain('novel_promotion_free_voice_records')
    expect(migration).toContain('novel_promotion_free_voice_versions')
  })
})
