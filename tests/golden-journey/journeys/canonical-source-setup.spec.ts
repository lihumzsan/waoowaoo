import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { expect, test } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  readGoldenMainlineBoundary,
  reloadGoldenBoundary,
  submitGoldenBoundary,
} from '../browser/pages/workspace'
import { writeGoldenSourceFixtureManifest } from '../fixtures/source-manifest'
import { listGoldenWorkflowCheckpointStages } from '../fixtures/workflow-lab'
import { attachGoldenOracleEvidence } from '../oracle/evidence'

test('[GJ-CANONICAL-SOURCE-SETUP] real UI creates a reloadable script-review checkpoint', async ({ page, context }, testInfo) => {
  test.setTimeout(3 * 60_000)
  const username = `golden-source-${String(Date.now())}`
  const password = 'golden-source-password'
  await registerGoldenUser(page, { username, password })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  const authStatePath = path.resolve(process.cwd(), 'artifacts/golden-journey/fixtures/source-auth.json')
  await mkdir(path.dirname(authStatePath), { recursive: true })
  await context.storageState({ path: authStatePath })
  await writeGoldenSourceFixtureManifest({
    username,
    password,
    scope,
    authStatePath,
    createdAt: new Date().toISOString(),
  })

  await expect.poll(async () => await readGoldenMainlineBoundary(page), { timeout: 60_000 }).toBe('script_intake')
  await reloadGoldenBoundary(page, 'script_intake')
  await submitGoldenBoundary(page, 'script_intake')
  await expect.poll(async () => await readGoldenMainlineBoundary(page), { timeout: 90_000 }).toBe('script_review')
  await reloadGoldenBoundary(page, 'script_review')
  const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-canonical-source-script-review')
  expect(oracle.domain.sourceDocuments).toHaveLength(1)
  expect(oracle.interruptions.some((item) => (
    item.type === 'choice' && item.status === 'pending' && item.operationId === 'request_edit_script_review_choice'
  ))).toBe(true)
  const checkpointStages = await listGoldenWorkflowCheckpointStages({ page, source: scope })
  await writeGoldenSourceFixtureManifest({
    username,
    password,
    scope,
    checkpointSources: Object.fromEntries(checkpointStages.map((stage) => [stage, scope])),
    authStatePath,
    createdAt: new Date().toISOString(),
  })
})
