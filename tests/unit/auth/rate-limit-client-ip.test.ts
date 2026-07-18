import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { getClientIp } from '@/lib/rate-limit'

describe('authentication rate-limit client identity', () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS
  })

  function request(forwardedFor: string): NextRequest {
    return new NextRequest('http://localhost/api/auth/register', {
      headers: { 'x-forwarded-for': forwardedFor, 'x-real-ip': '9.9.9.9' },
    })
  }

  it('ignores spoofable forwarding headers when no trusted proxy is configured', () => {
    process.env.TRUSTED_PROXY_HOPS = '0'
    expect(getClientIp(request('1.1.1.1'))).toBe('unresolved-client')
  })

  it('selects the client address relative to the configured trusted proxy count', () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(getClientIp(request('spoofed, 8.8.8.8, 10.0.0.5'))).toBe('8.8.8.8')
  })

  it('fails closed to a shared bucket for malformed or incomplete chains', () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(getClientIp(request('not-an-ip, 10.0.0.5'))).toBe('unresolved-client')
  })
})
