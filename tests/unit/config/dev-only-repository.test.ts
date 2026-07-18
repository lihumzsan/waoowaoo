import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

const root = process.cwd()

function readRootFile(path: string) {
  return readFileSync(join(root, path), 'utf8')
}

describe('dev-only repository contract', () => {
  test('Docker Compose contains local infrastructure only', () => {
    const compose = readRootFile('docker-compose.yml')

    expect(compose).toMatch(/^services:/)
    expect(compose).toMatch(/^  mysql:/m)
    expect(compose).toMatch(/^  redis:/m)
    expect(compose).toMatch(/^  minio:/m)
    expect(compose).not.toMatch(/^  app:/m)
    expect(compose).not.toContain('container_name:')
    expect(compose).not.toContain('restart:')
    expect(compose).toContain('"127.0.0.1:13306:3306"')
    expect(compose).toContain('"127.0.0.1:16379:6379"')
    expect(compose).toContain('"127.0.0.1:19000:9000"')
    expect(compose).toContain('"127.0.0.1:19001:9001"')
    expect(compose).toMatch(/^  mysql_data:$/m)
    expect(compose).toMatch(/^  redis_data:$/m)
    expect(compose).toMatch(/^  minio_data:$/m)
  })

  test('application deployment files are absent', () => {
    for (const path of [
      'Dockerfile',
      '.dockerignore',
      '.github/workflows/docker-publish.yml',
      'caddyfile',
      'docker-compose.test.yml',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false)
    }
  })

  test('npm scripts expose development infrastructure without production start commands', () => {
    const packageJson = JSON.parse(readRootFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['infra:up']).toBe('docker compose up -d --wait')
    expect(packageJson.scripts['infra:down']).toBe('docker compose down')
    expect(packageJson.scripts['infra:logs']).toBe('docker compose logs -f')
    expect(packageJson.scripts['infra:status']).toBe('docker compose ps')
    expect(packageJson.scripts.start).toBeUndefined()
    expect(packageJson.scripts['start:next']).toBeUndefined()
    expect(packageJson.scripts['start:worker']).toBeUndefined()
    expect(packageJson.scripts['start:watchdog']).toBeUndefined()
    expect(packageJson.scripts['start:board']).toBeUndefined()
  })
})
