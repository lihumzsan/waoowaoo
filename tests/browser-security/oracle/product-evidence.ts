import type { TestInfo } from '@playwright/test'

export async function attachSecurityProductEvidence(
  testInfo: TestInfo,
  name: string,
  evidence: unknown,
): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  })
}
