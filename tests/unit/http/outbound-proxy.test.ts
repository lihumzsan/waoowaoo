import { afterEach, describe, expect, it, vi } from 'vitest'

const proxyAgentMock = vi.hoisted(() => vi.fn((url: string) => ({ kind: 'proxy-agent', url })))
const undiciFetchMock = vi.hoisted(() => vi.fn(async () => new Response('proxied')))
const previousDispatcher = vi.hoisted(() => ({ kind: 'previous-dispatcher' }))
const getGlobalDispatcherMock = vi.hoisted(() => vi.fn(() => previousDispatcher))
const setGlobalDispatcherMock = vi.hoisted(() => vi.fn())

vi.mock('undici', () => ({
  ProxyAgent: proxyAgentMock,
  fetch: undiciFetchMock,
  getGlobalDispatcher: getGlobalDispatcherMock,
  setGlobalDispatcher: setGlobalDispatcherMock,
}))

describe('outbound provider proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('uses normal fetch when proxy env is not configured', async () => {
    vi.stubEnv('PROXY_URL', '')
    vi.stubEnv('HTTPS_PROXY', '')
    vi.stubEnv('https_proxy', '')
    vi.stubEnv('HTTP_PROXY', '')
    vi.stubEnv('http_proxy', '')
    vi.stubEnv('ALL_PROXY', '')
    vi.stubEnv('all_proxy', '')
    vi.stubEnv('NO_PROXY', '')
    vi.stubEnv('no_proxy', '')
    const globalFetchMock = vi.fn(async () => new Response('direct'))
    vi.stubGlobal('fetch', globalFetchMock)

    const { fetchWithProviderProxy } = await import('@/lib/http/outbound-proxy')
    const response = await fetchWithProviderProxy('https://openrouter.ai/api/v1/models')

    await expect(response.text()).resolves.toBe('direct')
    expect(globalFetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', undefined)
    expect(proxyAgentMock).not.toHaveBeenCalled()
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })

  it('uses undici ProxyAgent for external provider urls when proxy env is configured', async () => {
    vi.stubEnv('PROXY_URL', 'http://127.0.0.1:7890')
    vi.stubEnv('NO_PROXY', '')
    vi.stubEnv('no_proxy', '')
    const globalFetchMock = vi.fn(async () => new Response('direct'))
    vi.stubGlobal('fetch', globalFetchMock)

    const { fetchWithProviderProxy } = await import('@/lib/http/outbound-proxy')
    const response = await fetchWithProviderProxy('https://openrouter.ai/api/v1/models', {
      method: 'GET',
    })

    await expect(response.text()).resolves.toBe('proxied')
    expect(proxyAgentMock).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        method: 'GET',
        dispatcher: { kind: 'proxy-agent', url: 'http://127.0.0.1:7890' },
      }),
    )
    expect(globalFetchMock).not.toHaveBeenCalled()
  })

  it('does not proxy local urls even when proxy env is configured', async () => {
    vi.stubEnv('PROXY_URL', 'http://127.0.0.1:7890')
    const globalFetchMock = vi.fn(async () => new Response('local'))
    vi.stubGlobal('fetch', globalFetchMock)

    const { fetchWithProviderProxy } = await import('@/lib/http/outbound-proxy')
    const response = await fetchWithProviderProxy('http://localhost:3000/api/health')

    await expect(response.text()).resolves.toBe('local')
    expect(globalFetchMock).toHaveBeenCalledWith('http://localhost:3000/api/health', undefined)
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })

  it('does not proxy urls excluded by NO_PROXY', async () => {
    vi.stubEnv('PROXY_URL', 'http://127.0.0.1:7890')
    vi.stubEnv('NO_PROXY', 'openrouter.ai, .internal.example')
    const globalFetchMock = vi.fn(async () => new Response('excluded'))
    vi.stubGlobal('fetch', globalFetchMock)

    const { fetchWithProviderProxy } = await import('@/lib/http/outbound-proxy')
    const response = await fetchWithProviderProxy('https://api.openrouter.ai/v1/chat/completions')

    await expect(response.text()).resolves.toBe('excluded')
    expect(globalFetchMock).toHaveBeenCalledWith('https://api.openrouter.ai/v1/chat/completions', undefined)
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })

  it('restores the previous dispatcher after scoped SDK proxy calls', async () => {
    vi.stubEnv('PROXY_URL', 'http://127.0.0.1:7890')
    vi.stubEnv('NO_PROXY', '')
    vi.stubEnv('no_proxy', '')

    const { withProviderProxyDispatcher } = await import('@/lib/http/outbound-proxy')
    const result = await withProviderProxyDispatcher('https://generativelanguage.googleapis.com', async () => {
      expect(setGlobalDispatcherMock).toHaveBeenLastCalledWith({
        kind: 'proxy-agent',
        url: 'http://127.0.0.1:7890',
      })
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(getGlobalDispatcherMock).toHaveBeenCalledTimes(1)
    expect(setGlobalDispatcherMock).toHaveBeenLastCalledWith(previousDispatcher)
  })

  it('does not set a dispatcher for local SDK target urls', async () => {
    vi.stubEnv('PROXY_URL', 'http://127.0.0.1:7890')

    const { withProviderProxyDispatcher } = await import('@/lib/http/outbound-proxy')
    const result = await withProviderProxyDispatcher('http://127.0.0.1:9876/google', async () => 'local')

    expect(result).toBe('local')
    expect(proxyAgentMock).not.toHaveBeenCalled()
    expect(getGlobalDispatcherMock).not.toHaveBeenCalled()
    expect(setGlobalDispatcherMock).not.toHaveBeenCalled()
  })
})
