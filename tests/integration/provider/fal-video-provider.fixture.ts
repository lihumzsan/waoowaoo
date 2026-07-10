import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'fal',
  name: 'fal',
  apiKey: 'fal-key',
})))

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

import { executeFalVideoGeneration } from '@/lib/ai-providers/fal/video'

export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
export { startScenarioServer } from '../../helpers/fakes/scenario-server'
export { executeFalVideoGeneration } from '@/lib/ai-providers/fal/video'
export { getProviderConfigMock }
