import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vitest'

test('the full development command includes the one-shot warmup process', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }

  expect(packageJson.scripts['dev:warmup'])
    .toBe('tsx --env-file=.env scripts/dev-warmup.ts')
  expect(packageJson.scripts.dev).toContain('npm run dev:warmup')
  expect(packageJson.scripts['dev:warmup']).not.toContain('watch')
  expect(packageJson.scripts.start).not.toContain('dev:warmup')
})
