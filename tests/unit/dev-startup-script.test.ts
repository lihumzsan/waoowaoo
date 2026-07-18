import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vitest'

test('the default development command leaves warmup opt-in', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }

  expect(packageJson.scripts.dev).not.toContain('dev:warmup')
  expect(packageJson.scripts['dev:warmup']).toBeDefined()
  expect(packageJson.scripts['dev:full']).toBe(
    'concurrently "npm run dev" "npm run dev:warmup"',
  )
})
