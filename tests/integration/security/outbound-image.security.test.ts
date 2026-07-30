import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OutboundImageNormalizeError,
  normalizeOptionalReferenceImagesForGeneration,
  normalizeReferenceImagesForGeneration,
  normalizeToBase64ForGeneration,
  normalizeToOriginalMediaUrl,
  sanitizeImageInputsForTaskPayload,
} from '@/lib/media/outbound-image'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { lookup } from 'node:dns/promises'

vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: vi.fn(async (key: string) => `/signed/${key}`),
  toFetchableUrl: vi.fn((value: string) => (
    value.startsWith('/') ? `https://app.example.com${value}` : value
  )),
}))

vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

describe('outbound-image normalization', () => {
  const fetchMock = vi.fn()
  const resolveStorageKeyMock = vi.mocked(resolveStorageKeyFromMediaValue)
  const dnsLookupMock = vi.mocked(lookup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NEXTAUTH_URL', 'https://app.example.com')
    vi.stubEnv('INTERNAL_APP_URL', '')
    vi.stubEnv('INTERNAL_TASK_API_BASE_URL', '')

    resolveStorageKeyMock.mockImplementation(async (value: unknown) => {
      if (value === '/m/pub-1') return 'images/from-media.png'
      return null
    })

    fetchMock.mockResolvedValue(new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }))

    dnsLookupMock.mockResolvedValue(
      { address: '93.184.216.34', family: 4 } as unknown as { address: string; family: number },
    )
  })

  it('keeps data url unchanged', async () => {
    const dataUrl = 'data:image/png;base64,AAAA'
    expect(await normalizeToOriginalMediaUrl(dataUrl)).toBe(dataUrl)
  })

  it('throws structured error on empty input', async () => {
    await expect(normalizeToOriginalMediaUrl('')).rejects.toBeInstanceOf(OutboundImageNormalizeError)
    await expect(normalizeToOriginalMediaUrl('')).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_EMPTY_INPUT',
      stage: 'normalize_original',
    })
  })

  it('unwraps next/image and resolves /m route to signed source', async () => {
    const input = '/_next/image?url=%2Fm%2Fpub-1&w=640&q=75'
    const normalized = await normalizeToOriginalMediaUrl(input)
    expect(normalized).toBe('https://app.example.com/signed/images/from-media.png')
  })

  it('fails explicitly when /m route cannot be resolved to storage key', async () => {
    await expect(normalizeToOriginalMediaUrl('/m/missing-id')).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_MEDIA_ROUTE_UNRESOLVED',
      stage: 'normalize_original',
    })
  })

  it('signs storage key inputs', async () => {
    const normalized = await normalizeToOriginalMediaUrl('images/direct.png')
    expect(normalized).toBe('https://app.example.com/signed/images/direct.png')
  })

  it('resolves storage sign api route without fetching the authenticated route', async () => {
    const normalized = await normalizeToOriginalMediaUrl('/api/storage/sign?key=images%2Fdirect.png&expires=3600')
    expect(normalized).toBe('https://app.example.com/signed/images/direct.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects retired internal api file routes', async () => {
    await expect(normalizeToOriginalMediaUrl('/api/files/images%2Fa.png')).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
      stage: 'normalize_original',
    })
  })

  it('fails explicitly on unsupported root-relative input', async () => {
    await expect(normalizeToOriginalMediaUrl('/foo/bar.png')).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
      stage: 'normalize_original',
    })
  })

  it('keeps http input as-is', async () => {
    const input = 'https://example.com/a.png'
    expect(await normalizeToOriginalMediaUrl(input)).toBe(input)
  })

  it('rejects private ip outbound urls as unsafe', async () => {
    await expect(normalizeToOriginalMediaUrl('http://127.0.0.1/a.png')).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage: 'normalize_original',
    })
  })

  it('rejects hostnames whose DNS answer contains a private address', async () => {
    dnsLookupMock.mockResolvedValue(
      [{ address: '10.0.0.8', family: 4 }] as never,
    )
    await expect(normalizeToOriginalMediaUrl('https://attacker.example/a.png')).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage: 'normalize_original',
    })
  })

  it('resolves transparent-proxy fake IPs through trusted public DNS', async () => {
    dnsLookupMock.mockResolvedValue(
      [{ address: '198.18.0.8', family: 4 }] as never,
    )
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://cloudflare-dns.com/dns-query')) {
        return new Response(JSON.stringify({
          Answer: [{ type: 1, data: '93.184.216.34' }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })
      }
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    })

    await expect(normalizeToBase64ForGeneration('https://example.com/a.png'))
      .resolves.toBe('data:image/png;base64,AQID')
  })

  it('rejects outbound redirect to private ip', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/secret.png' },
      }))

    await expect(normalizeToBase64ForGeneration('https://example.com/a.png')).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage: 'normalize_base64',
    })
  })

  it('converts normalized source to data url base64 payload', async () => {
    const dataUrl = await normalizeToBase64ForGeneration('images/direct.png')
    expect(dataUrl).toBe('data:image/png;base64,AQID')
  })

  it('sniffs png mime when upstream returns application/octet-stream', async () => {
    fetchMock.mockResolvedValue(new Response(Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
      ]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }))

    const dataUrl = await normalizeToBase64ForGeneration('images/direct.png')
    expect(dataUrl).toBe('data:image/png;base64,iVBORw0KGgoAAAAN')
  })

  it('sniffs jpeg mime when upstream returns application/octet-stream', async () => {
    fetchMock.mockResolvedValue(new Response(Uint8Array.from([
        0xff, 0xd8, 0xff, 0xe0,
        0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01,
      ]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }))

    const dataUrl = await normalizeToBase64ForGeneration('images/direct.jpg')
    expect(dataUrl).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgAB')
  })

  it('normalizes references with dedupe and failure isolation', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/bad.png')) {
        return new Response(null, {
          status: 404,
        })
      }
      return new Response(Uint8Array.from([7, 8, 9]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    })

    const normalized = await normalizeReferenceImagesForGeneration([
      'images/direct.png',
      'images/direct.png',
      '/api/bad.png',
    ])
    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toBe('data:image/png;base64,BwgJ')
  })

  it('reports structured issue and fails explicitly when all references fail', async () => {
    fetchMock.mockResolvedValue(new Response(null, {
      status: 500,
    }))

    const issues: Array<{
      code: string
      stage: string
      message: string
      input: string
      index: number
    }> = []

    await expect(
      normalizeReferenceImagesForGeneration(['images/bad.png'], {
        onIssue: (issue) => issues.push(issue),
      }),
    ).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_REFERENCE_ALL_FAILED',
      stage: 'normalize_reference',
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'OUTBOUND_IMAGE_FETCH_FAILED',
      stage: 'normalize_base64',
      input: 'images/bad.png',
      index: 0,
    })
  })

  it('fails open for optional references when all candidates fail', async () => {
    fetchMock.mockResolvedValue(new Response(null, {
      status: 500,
    }))

    const issues: Array<{
      code: string
      stage: string
      message: string
      input: string
      index: number
    }> = []

    await expect(
      normalizeOptionalReferenceImagesForGeneration(['images/bad.png'], {
        onIssue: (issue) => issues.push(issue),
        context: { scope: 'test' },
      }),
    ).resolves.toEqual([])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'OUTBOUND_IMAGE_FETCH_FAILED',
      stage: 'normalize_base64',
      input: 'images/bad.png',
      index: 0,
    })
  })

  it('sanitizes task payload urls and reports input issues', () => {
    const result = sanitizeImageInputsForTaskPayload([
      '/_next/image?url=images%2Fa.png&w=1080&q=75',
      '',
      123,
      '/relative/path.png',
    ])

    expect(result.normalized).toEqual(['images/a.png'])
    expect(result.issues.map((item) => item.reason)).toEqual([
      'next_image_unwrapped',
      'empty_value_skipped',
      'non_string_skipped',
      'relative_path_rejected',
    ])
  })
})
