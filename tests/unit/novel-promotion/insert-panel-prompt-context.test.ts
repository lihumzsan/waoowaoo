import { describe, expect, it } from 'vitest'
import { buildInsertPanelLocationsDescription } from '@/lib/novel-promotion/insert-panel-prompt-context'

describe('insert panel prompt context', () => {
  it('injects available slots for related selected location images', () => {
    const text = buildInsertPanelLocationsDescription(
      [
        {
          name: '餐厅',
          images: [
            {
              isSelected: true,
              description: '长方形饭桌位于画面中央',
              availableSlots: JSON.stringify([
                '饭桌左侧靠桌边的位置',
              ]),
            },
          ],
        },
        {
          name: '客厅',
          images: [{ isSelected: true, description: '不会被选中' }],
        },
      ],
      ['餐厅'],
    )

    expect(text).toContain('餐厅: 长方形饭桌位于画面中央')
    expect(text).toContain('可站位置：')
    expect(text).toContain('饭桌左侧靠桌边的位置')
    expect(text).not.toContain('客厅')
  })
})
