import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisSetMock = vi.hoisted(() => vi.fn(async () => 'OK'))
const redisGetMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/redis', () => ({
  redis: {
    set: redisSetMock,
    get: redisGetMock,
  },
  queueRedis: {},
}))
vi.mock('@/lib/task/queues', () => ({
  addTaskJob: vi.fn(),
}))

describe('video tools free voice Redis records', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores the transient result list for one day only', async () => {
    const { saveVideoToolFreeVoiceRecord } = await import('@/lib/video-tools/free-voice')

    await saveVideoToolFreeVoiceRecord('user-1', {
      id: 'record-1',
      taskId: 'task-1',
      text: 'hello',
      voiceName: 'Narrator',
      status: 'queued',
      progress: 0,
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
    })

    expect(redisSetMock).toHaveBeenCalledWith(
      'video-tools:free-voice:user-1:records',
      expect.stringContaining('record-1'),
      'EX',
      86_400,
    )
  })

  it('stores generated audio in Redis with the same one-day ttl', async () => {
    const { saveVideoToolFreeVoiceAudio } = await import('@/lib/video-tools/free-voice')

    await saveVideoToolFreeVoiceAudio('user-1', 'record-1', Buffer.from('audio'), 'audio/wav')

    expect(redisSetMock).toHaveBeenCalledWith(
      'video-tools:free-voice:user-1:record-1:audio',
      JSON.stringify({ mimeType: 'audio/wav', data: Buffer.from('audio').toString('base64') }),
      'EX',
      86_400,
    )
  })
})
