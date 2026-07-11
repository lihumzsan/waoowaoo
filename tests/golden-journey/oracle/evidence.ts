import type { TestInfo } from '@playwright/test'
import type { GoldenWorkspaceScope } from '../browser/pages/home'
import { readGoldenOracleSnapshot } from './reader'
import type { GoldenOracleSnapshot } from './types'

export async function attachGoldenOracleEvidence(
  testInfo: TestInfo,
  scope: GoldenWorkspaceScope,
  name = 'golden-oracle-snapshot',
): Promise<GoldenOracleSnapshot> {
  const snapshot = await readGoldenOracleSnapshot(scope)
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(snapshot, null, 2)),
    contentType: 'application/json',
  })
  return snapshot
}
