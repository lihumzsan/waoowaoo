import { expect, test } from '../browser/test'

test('Golden browser harness captures a clean real Chromium page', async ({
  page,
  browserObservations,
}) => {
  await page.setContent('<main><h1>Golden Journey harness</h1></main>')
  await expect(page.getByRole('heading', { name: 'Golden Journey harness' })).toBeVisible()
  browserObservations.assertClean()
})

