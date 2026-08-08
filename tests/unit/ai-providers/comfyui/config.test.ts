import { describe, expect, it } from 'vitest'
import { readComfyUiBaseUrl } from '@/lib/ai-providers/comfyui/config'

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
})
