import { describe, expect, it } from 'vitest'
import {
  findDemoSnapshotPrivateMediaReferences,
  isPrivateDemoMediaReference,
} from '@/lib/demo/demo-snapshot'

describe('demo snapshot media validation', () => {
  it('detects private workspace media references before publishing a snapshot', () => {
    expect(isPrivateDemoMediaReference('/m/m_private')).toBe(true)
    expect(isPrivateDemoMediaReference('/api/storage/sign?key=images/a.png')).toBe(true)
    expect(isPrivateDemoMediaReference('images/source.png')).toBe(true)
    expect(isPrivateDemoMediaReference('audio/mpeg')).toBe(false)
    expect(isPrivateDemoMediaReference('/demo-assets/matrix-demo/source.png')).toBe(false)
  })

  it('returns every nested private media reference for explicit export failure', () => {
    const references = findDemoSnapshotPrivateMediaReferences({
      image: { url: '/m/m_private' },
      videos: ['video/source.mp4', '/demo-assets/matrix-demo/public.mp4'],
    })

    expect(references).toEqual(['/m/m_private', 'video/source.mp4'])
  })
})
