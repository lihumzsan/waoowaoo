import { describe, expect, it } from 'vitest'
import { parseE2eRunnerConfig } from '../../../scripts/e2e-long-form/config'

describe('long-form E2E runner config', () => {
  it('parses a selectable target stage instead of fixed core/full modes', () => {
    const config = parseE2eRunnerConfig([
      '--mode=live',
      '--target=video_plan_ready',
      '--generation=plan-only',
      '--base-url=http://localhost:3000/',
      '--prompt=测试创意',
      '--stage-timeout-ms=1000',
      '--overall-timeout-ms=2000',
    ])

    expect(config.mode).toBe('live')
    expect(config.target).toBe('video_plan_ready')
    expect(config.generation).toBe('plan-only')
    expect(config.baseUrl).toBe('http://localhost:3000')
    expect(config.prompt).toBe('测试创意')
  })

  it('rejects final output targets when generation is plan-only', () => {
    expect(() => parseE2eRunnerConfig([
      '--target=final_video_ready',
      '--generation=plan-only',
    ])).toThrow('E2E_TARGET_REQUIRES_REAL_GENERATION:final_video_ready')
  })

  it('rejects unknown target stages explicitly', () => {
    expect(() => parseE2eRunnerConfig([
      '--target=core',
    ])).toThrow('E2E_OPTION_INVALID:target:core')
  })
})
