import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

const root = process.cwd()

function readRootFile(path: string) {
  return readFileSync(join(root, path), 'utf8')
}

describe('remote-only development repository contract', () => {
  test('local Docker entry points are absent', () => {
    for (const path of [
      'Dockerfile',
      '.dockerignore',
      'docker-compose.yml',
      'docker-compose.test.yml',
      '.github/workflows/docker-publish.yml',
      'caddyfile',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false)
    }
  })

  test('npm scripts contain no infrastructure or production start commands', () => {
    const packageJson = JSON.parse(readRootFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.dev).not.toContain('npm run dev:warmup')
    expect(packageJson.scripts['dev:full']).toContain('npm run dev:warmup')
    expect(packageJson.scripts['infra:up']).toBeUndefined()
    expect(packageJson.scripts['infra:down']).toBeUndefined()
    expect(packageJson.scripts['infra:logs']).toBeUndefined()
    expect(packageJson.scripts['infra:status']).toBeUndefined()
    expect(packageJson.scripts.start).toBeUndefined()
    expect(packageJson.scripts['start:next']).toBeUndefined()
    expect(packageJson.scripts['start:worker']).toBeUndefined()
    expect(packageJson.scripts['start:watchdog']).toBeUndefined()
    expect(packageJson.scripts['start:board']).toBeUndefined()
  })

  test('environment template targets the remote infrastructure host', () => {
    const envTemplate = readRootFile('.env.example')

    expect(envTemplate).toContain(
      'DATABASE_URL="mysql://root:waoowaoo123@192.168.0.112:13306/waoowaoo"',
    )
    expect(envTemplate).toContain('REDIS_HOST=192.168.0.112')
    expect(envTemplate).toContain('REDIS_PORT=16379')
    expect(envTemplate).toContain('MINIO_ENDPOINT=http://192.168.0.112:19000')
    expect(envTemplate).not.toMatch(
      /(?:localhost|127\.0\.0\.1):(13306|16379|19000|19001)/,
    )
    expect(envTemplate).not.toMatch(
      /^REDIS_HOST=(?:localhost|127\.0\.0\.1)$/m,
    )
  })
})
