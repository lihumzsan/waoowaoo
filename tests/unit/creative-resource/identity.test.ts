import { describe, expect, it } from 'vitest'
import {
  buildCreativeResourceId,
  buildDomainCreativeResourceId,
} from '@/lib/creative-resource/identity'

describe('Creative Resource short identity', () => {
  it('matches the canonical framed SHA-256 vectors and 24-character wire format', () => {
    const resourceId = buildCreativeResourceId({
      operationId: 'create_video',
      requestId: 'run-1:call-1',
      memberIndex: 0,
    })
    const domainResourceId = buildDomainCreativeResourceId({
      sourceType: 'user_upload',
      sourceId: 'project-1:sha256',
    })

    expect(resourceId).toBe('r_xmSzFbCVupy9D5d-Kp3TNg')
    expect(domainResourceId).toBe('r_T0EbEU94NUEOvCbR4S5EtQ')
    expect(resourceId).toMatch(/^r_[A-Za-z0-9_-]{22}$/)
  })

  it('frames every identity part so ambiguous concatenations cannot alias', () => {
    const left = buildCreativeResourceId({
      operationId: 'ab',
      requestId: 'c',
      memberIndex: 0,
    })
    const right = buildCreativeResourceId({
      operationId: 'a',
      requestId: 'bc',
      memberIndex: 0,
    })

    expect(left).toBe('r_MrX6RYbjmpjOMXZr2bHcsA')
    expect(right).toBe('r_hMsyMZOC6d3dQLOziMFrvg')
    expect(left).not.toBe(right)
  })

  it('changes identity when the immutable candidate index changes', () => {
    const first = buildCreativeResourceId({
      operationId: 'create_image',
      requestId: 'request-1',
      memberIndex: 0,
    })
    const second = buildCreativeResourceId({
      operationId: 'create_image',
      requestId: 'request-1',
      memberIndex: 1,
    })

    expect(first).not.toBe(second)
  })
})
