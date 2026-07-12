import { test as base } from '@playwright/test'
import { createHash } from 'node:crypto'
import { GoldenBrowserObservations } from './observations'
import { resolveGoldenExternalBoundary } from './external-boundaries'
import { isGoldenBrowserNetworkAllowed } from './network-policy'

interface GoldenBrowserFixtures {
  readonly browserObservations: GoldenBrowserObservations
}

export const test = base.extend<GoldenBrowserFixtures>({
  browserObservations: async ({ page, context }, provide, testInfo) => {
    const observations = new GoldenBrowserObservations()
    const clientIdentity = createHash('sha256').update(testInfo.testId).digest()
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `198.18.${String(clientIdentity[0] ?? 0)}.${String((clientIdentity[1] ?? 0) || 1)}`,
    })
    await context.route('**/*', async (route) => {
      const externalBoundary = resolveGoldenExternalBoundary({
        method: route.request().method(),
        url: route.request().url(),
      })
      if (externalBoundary) {
        await route.fulfill(externalBoundary)
        return
      }
      if (isGoldenBrowserNetworkAllowed(route.request().url())) {
        await route.continue()
        return
      }
      observations.recordBlockedExternalRequest(route.request())
      await route.abort('blockedbyclient')
    })
    observations.attach(page)
    await provide(observations)
    await observations.attachEvidence(testInfo)
  },
})

export { expect } from '@playwright/test'
