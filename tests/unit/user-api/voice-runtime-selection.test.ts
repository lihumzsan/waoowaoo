import { describe, expect, it, vi } from 'vitest'

// PG-16:voice 是平台固定模态。user-key 部署的运行时模型表来自用户 customModels,
// 而配置面根本不存在 voice 类型 —— 修复前 voice 选择在 user-key 模式必然
// MODEL_NOT_FOUND(修复前本用例会先落进 prisma 读取用户配置而失败)。
// 该 mock 只替换部署模式判定(环境配置 seam),不触碰被测的模型解析逻辑。
vi.mock('@/lib/deployment/config', () => ({
  getDeploymentConfig: () => ({
    edition: 'self-hosted',
    providerCredentialMode: 'user-key',
  }),
  isPlatformProviderCredentialMode: () => false,
}))

import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { PLATFORM_VOICE_DESIGN_MODEL_KEY } from '@/lib/ai-registry/voice-design-contract'

describe('voice runtime selection under user-key deployments', () => {
  it('resolves the platform voice-design model without reading user custom models', async () => {
    const selection = await resolveModelSelection(
      'user-without-any-custom-models',
      PLATFORM_VOICE_DESIGN_MODEL_KEY,
      'voice',
    )
    expect(selection.provider).toBe('fal')
    expect(`${selection.provider}::${selection.modelId}`).toBe(PLATFORM_VOICE_DESIGN_MODEL_KEY)
  })
})
