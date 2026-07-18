import net from 'node:net'
import { lookup } from 'node:dns/promises'

export class UnsafeOutboundUrlError extends Error {
  readonly code = 'OUTBOUND_URL_UNSAFE'

  constructor(message: string) {
    super(message)
    this.name = 'UnsafeOutboundUrlError'
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const numbers = parts.map(Number)
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((numbers[0] << 24) >>> 0) + (numbers[1] << 16) + (numbers[2] << 8) + numbers[3]) >>> 0
}

function isIpv4InRange(ip: string, base: string, maskBits: number): boolean {
  const ipValue = ipv4ToInt(ip)
  const baseValue = ipv4ToInt(base)
  if (ipValue === null || baseValue === null) return false
  const mask = maskBits === 0 ? 0 : (~((2 ** (32 - maskBits)) - 1) >>> 0)
  return (ipValue & mask) === (baseValue & mask)
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
      ['255.255.255.255', 32],
    ].some(([base, maskBits]) => isIpv4InRange(ip, String(base), Number(maskBits)))
  }
  if (family === 6) {
    const normalized = ip.toLowerCase()
    if (normalized === '::' || normalized === '::1') return true
    if (normalized.startsWith('ff') || /^(fc|fd)/.test(normalized) || /^fe[89ab]/.test(normalized)) return true
    if (normalized.startsWith('2001:db8')) return true
    const mappedPrefix = '::ffff:'
    const mappedIndex = normalized.lastIndexOf(mappedPrefix)
    return mappedIndex === -1
      ? false
      : isPrivateOrReservedIp(normalized.slice(mappedIndex + mappedPrefix.length))
  }
  return true
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
}

function privateHostAllowlist(): Set<string> {
  return new Set((process.env.PROVIDER_OUTBOUND_PRIVATE_HOST_ALLOWLIST || '')
    .split(',')
    .map(normalizeHostname)
    .filter(Boolean))
}

function isExplicitlyAllowedPrivateHost(hostname: string): boolean {
  return privateHostAllowlist().has(normalizeHostname(hostname))
}

function parseProviderUrl(input: string): URL {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new UnsafeOutboundUrlError('provider URL must be an absolute HTTP(S) URL')
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeOutboundUrlError('provider URL credentials are not allowed')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UnsafeOutboundUrlError('provider URL protocol is not allowed')
  }
  const hostname = normalizeHostname(parsed.hostname)
  const privateHostAllowed = isExplicitlyAllowedPrivateHost(hostname)
  if (parsed.protocol !== 'https:' && !privateHostAllowed) {
    throw new UnsafeOutboundUrlError('provider URL must use HTTPS')
  }
  if (
    !privateHostAllowed
    && (hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname === 'metadata'
      || hostname === 'metadata.internal'
      || hostname === 'metadata.google.internal')
  ) {
    throw new UnsafeOutboundUrlError('provider URL hostname is not allowed')
  }
  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname) && !privateHostAllowed) {
    throw new UnsafeOutboundUrlError('provider URL private IP is not allowed')
  }
  return parsed
}

export function assertProviderBaseUrlShape(input: string): string {
  return parseProviderUrl(input).toString().replace(/\/$/, '')
}

export async function assertSafeProviderOutboundUrl(input: string): Promise<URL> {
  const parsed = parseProviderUrl(input)
  const hostname = normalizeHostname(parsed.hostname)
  if (isExplicitlyAllowedPrivateHost(hostname) || net.isIP(hostname)) return parsed

  let addresses: Array<{ address: string }> = []
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new UnsafeOutboundUrlError('provider URL DNS lookup failed')
  }
  if (addresses.length === 0) throw new UnsafeOutboundUrlError('provider URL DNS lookup returned no addresses')
  if (addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new UnsafeOutboundUrlError('provider URL resolves to a private or reserved IP')
  }
  return parsed
}
