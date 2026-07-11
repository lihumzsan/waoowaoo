const originalFetch = globalThis.fetch
const allowedHosts = new Set(['127.0.0.1', 'localhost'])

if (typeof originalFetch !== 'function') {
  throw new Error('GOLDEN_NETWORK_GUARD_FETCH_MISSING')
}

globalThis.fetch = async (input, init) => {
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url
  const parsed = new URL(rawUrl, 'http://127.0.0.1')
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !allowedHosts.has(parsed.hostname)) {
    throw new Error(`GOLDEN_EXTERNAL_NETWORK_BLOCKED:${parsed.hostname}`)
  }
  return await originalFetch(input, init)
}

