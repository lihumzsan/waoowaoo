import { describe, expect, it } from 'vitest'
import {
  readComfyUiBaseUrl,
  resolveComfyUiRuntimeTarget,
} from '@/lib/ai-providers/comfyui/config'

function env(value: string | undefined): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', ...(value === undefined ? {} : { COMFYUI_BASE_URL: value }) }
}

describe('ComfyUI environment configuration', () => {
  it('reads and trims COMFYUI_BASE_URL without adding a provider default', () => {
    expect(readComfyUiBaseUrl(env(' http://127.0.0.1:8188/ '))).toBe('http://127.0.0.1:8188')
  })

  it('rejects a missing URL', () => {
    expect(() => readComfyUiBaseUrl(env(undefined))).toThrow('COMFYUI_BASE_URL_MISSING')
  })

  it('rejects credentials, query strings, hashes, and non-http protocols', () => {
    for (const value of [
      'http://user:pass@host:8188',
      'http://host:8188/path?token=secret',
      'http://host:8188/path#fragment',
      'ftp://host:8188',
    ]) {
      expect(() => readComfyUiBaseUrl(env(value))).toThrow('COMFYUI_BASE_URL_INVALID')
    }
  })

  it('resolves the isolated H3 target from its own environment key', () => {
    expect(resolveComfyUiRuntimeTarget('h3-dual-stage-2mp', {
      NODE_ENV: 'test',
      COMFYUI_H3_DUAL_STAGE_BASE_URL: ' http://127.0.0.1:8188/ ',
    })).toEqual({ id: 'h3-dual-stage-2mp', baseUrl: 'http://127.0.0.1:8188' })
  })

  it('does not fall back to the shared target URL', () => {
    expect(() => resolveComfyUiRuntimeTarget('h3-dual-stage-2mp', {
      NODE_ENV: 'test',
      COMFYUI_BASE_URL: 'http://127.0.0.1:8878',
    })).toThrow('COMFYUI_RUNTIME_TARGET_MISSING:h3-dual-stage-2mp')
  })
})
