import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertProviderBaseUrlShape,
  assertSafeProviderOutboundUrl,
  isPrivateOrReservedIp,
} from '@/lib/http/outbound-url-policy'

describe('provider outbound URL policy', () => {
  beforeEach(() => {
    delete process.env.PROVIDER_OUTBOUND_PRIVATE_HOST_ALLOWLIST
  })

  afterEach(() => {
    delete process.env.PROVIDER_OUTBOUND_PRIVATE_HOST_ALLOWLIST
  })

  it('rejects cleartext public endpoints, URL credentials, and private address literals', async () => {
    expect(() => assertProviderBaseUrlShape('http://api.example.com/v1')).toThrow('must use HTTPS')
    expect(() => assertProviderBaseUrlShape('https://user:pass@example.com/v1')).toThrow('credentials')
    await expect(assertSafeProviderOutboundUrl('https://127.0.0.1:8443/v1')).rejects.toThrow('private IP')
    await expect(assertSafeProviderOutboundUrl('https://[::1]:8443/v1')).rejects.toThrow('private IP')
  })

  it('allows an exact private host only through the explicit deployment allowlist', async () => {
    process.env.PROVIDER_OUTBOUND_PRIVATE_HOST_ALLOWLIST = '127.0.0.1'
    await expect(assertSafeProviderOutboundUrl('http://127.0.0.1:8080/v1')).resolves.toMatchObject({
      hostname: '127.0.0.1',
      port: '8080',
    })
    expect(() => assertProviderBaseUrlShape('http://127.0.0.2:8080/v1')).toThrow('must use HTTPS')
  })

  it('classifies private, metadata, documentation, multicast, and loopback ranges as reserved', () => {
    for (const address of ['10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.1', '203.0.113.8', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1']) {
      expect(isPrivateOrReservedIp(address), address).toBe(true)
    }
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false)
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false)
  })
})
