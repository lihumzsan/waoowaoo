import { test as base } from '@playwright/test'
import { GoldenBrowserObservations } from './observations'
import { isGoldenBrowserNetworkAllowed } from './network-policy'

interface GoldenBrowserFixtures {
  readonly browserObservations: GoldenBrowserObservations
}

export const test = base.extend<GoldenBrowserFixtures>({
  browserObservations: async ({ page, context }, provide, testInfo) => {
    const observations = new GoldenBrowserObservations()
    await context.route('**/*', async (route) => {
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
