import { describe, expect, it } from 'vitest'
import { matchCurrentUserText } from '@/lib/creative-resource/current-user-text'

describe('current user text capture', () => {
  it('accepts only an exact contiguous excerpt from the current visible user turn', () => {
    const currentUserTurnText = '这是我的剧本：\n场景一：夜，山门。\n请直接制作。'

    expect(matchCurrentUserText({
      currentUserTurnText,
      requestedText: '场景一：夜，山门。',
    })).toEqual({ ok: true, text: '场景一：夜，山门。' })
    expect(matchCurrentUserText({
      currentUserTurnText,
      requestedText: '场景一：深夜，山门。',
    })).toEqual({ ok: false, code: 'CURRENT_USER_TEXT_NOT_EXACT' })
  })

  it('rejects capture outside the initial user-turn execution segment', () => {
    expect(matchCurrentUserText({
      currentUserTurnText: null,
      requestedText: 'Earlier screenplay text',
    })).toEqual({ ok: false, code: 'CURRENT_USER_TEXT_UNAVAILABLE' })
  })
})
