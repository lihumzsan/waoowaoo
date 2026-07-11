import { describe, expect, it } from 'vitest'
import { isGoldenBrowserNetworkAllowed } from '../browser/network-policy'

describe('Golden Journey browser network policy', () => {
  it('allows only loopback and browser-local resource protocols', () => {
    expect(isGoldenBrowserNetworkAllowed('http://127.0.0.1:3100/zh/home')).toBe(true)
    expect(isGoldenBrowserNetworkAllowed('http://localhost:3100/api/test')).toBe(true)
    expect(isGoldenBrowserNetworkAllowed('data:text/plain,golden')).toBe(true)
    expect(isGoldenBrowserNetworkAllowed('blob:http://127.0.0.1:3100/id')).toBe(true)
    expect(isGoldenBrowserNetworkAllowed('https://api.github.com/repos/example')).toBe(false)
    expect(isGoldenBrowserNetworkAllowed('https://api.openai.com/v1/chat/completions')).toBe(false)
  })
})
