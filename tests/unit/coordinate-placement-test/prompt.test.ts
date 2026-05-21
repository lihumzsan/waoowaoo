import { describe, expect, it } from 'vitest'
import { buildCoordinatePlacementPrompt } from '@/lib/coordinate-placement-test/prompt'
import { coordinatePlacementTestRequestSchema } from '@/lib/coordinate-placement-test/types'

describe('coordinate placement test prompt', () => {
  it('states coordinate origin, target, and no-overlay output rule for overlay references', () => {
    const parsed = coordinatePlacementTestRequestSchema.parse({
      coordinateReferenceImage: 'data:image/png;base64,AAAA',
      characterImage: 'data:image/png;base64,BBBB',
      userPrompt: 'Place the person near the table.',
      referenceMode: 'overlay',
      grid: { columns: 16, rows: 9 },
      target: { x: 7, y: 4 },
    })

    const prompt = buildCoordinatePlacementPrompt(parsed, 'en')

    expect(prompt).toContain('coordinate (7, 4)')
    expect(prompt).toContain('16 X columns and 9 Y rows')
    expect(prompt).toContain('Coordinate (1,1) is the top-left cell')
    expect(prompt).toContain('Do not include any grid lines, coordinate labels, axes')
    expect(prompt).toContain('Place the person near the table.')
  })

  it('uses localized Chinese instructions for Chinese locale', () => {
    const parsed = coordinatePlacementTestRequestSchema.parse({
      coordinateReferenceImage: 'data:image/png;base64,AAAA',
      characterImage: 'data:image/png;base64,BBBB',
      userPrompt: '把人物放在桌子旁边。',
      referenceMode: 'outer_axes',
      grid: { columns: 16, rows: 9 },
      target: { x: 7, y: 4 },
    })

    const prompt = buildCoordinatePlacementPrompt(parsed, 'zh')

    expect(prompt).toContain('请把参考图 2 中的人物放到参考网格坐标 (7, 4)')
    expect(prompt).toContain('场景图片本身没有任何标记')
    expect(prompt).toContain('输出图中不得出现任何网格线')
  })

  it('rejects target coordinates outside the selected grid', () => {
    const parsed = coordinatePlacementTestRequestSchema.safeParse({
      coordinateReferenceImage: 'data:image/png;base64,AAAA',
      characterImage: 'data:image/png;base64,BBBB',
      userPrompt: 'Place the person near the table.',
      referenceMode: 'outer_axes',
      grid: { columns: 12, rows: 8 },
      target: { x: 13, y: 4 },
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['target', 'x'])
      expect(parsed.error.issues[0]?.message).toBe('target x must be inside grid columns')
    }
  })
})
