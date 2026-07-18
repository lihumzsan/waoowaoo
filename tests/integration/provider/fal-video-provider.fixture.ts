import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'fal',
  name: 'fal',
  apiKey: 'fal-key',
})))

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

const [{ executeFalVideoGeneration }, { startScenarioServer }] = await Promise.all([
  import('@/lib/ai-providers/fal/video'),
  import('../../helpers/fakes/scenario-server'),
])

export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
export { executeFalVideoGeneration, getProviderConfigMock, startScenarioServer }
