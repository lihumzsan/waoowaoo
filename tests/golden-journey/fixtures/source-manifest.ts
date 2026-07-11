import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GoldenWorkspaceScope } from '../browser/pages/home'

const SOURCE_MANIFEST_PATH = path.resolve(
  process.cwd(),
  'artifacts/golden-journey/fixtures/source.json',
)

export interface GoldenSourceFixtureManifest {
  readonly username: string
  readonly password: string
  readonly scope: GoldenWorkspaceScope
  readonly authStatePath: string
  readonly createdAt: string
}

export async function writeGoldenSourceFixtureManifest(
  manifest: GoldenSourceFixtureManifest,
): Promise<void> {
  await mkdir(path.dirname(SOURCE_MANIFEST_PATH), { recursive: true })
  await writeFile(SOURCE_MANIFEST_PATH, JSON.stringify(manifest, null, 2), { mode: 0o600 })
}

export async function readGoldenSourceFixtureManifest(): Promise<GoldenSourceFixtureManifest> {
  try {
    return JSON.parse(await readFile(SOURCE_MANIFEST_PATH, 'utf8')) as GoldenSourceFixtureManifest
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error('GOLDEN_SOURCE_FIXTURE_MANIFEST_MISSING')
    }
    throw error
  }
}
