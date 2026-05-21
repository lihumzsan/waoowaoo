import type { CoordinatePlacementTestRequest } from '@/lib/coordinate-placement-test/types'
import type { Locale } from '@/i18n/routing'

export function buildCoordinatePlacementPrompt(input: CoordinatePlacementTestRequest, locale: Locale): string {
  if (locale === 'zh') {
    const referenceDescription = input.referenceMode === 'outer_axes'
      ? '参考图 1 是原始场景图，图片上方有 X 坐标标签，图片左侧留白处有 Y 坐标标签；场景图片本身没有任何标记。'
      : '参考图 1 是叠加了坐标网格和坐标标签的场景图。'

    return [
      '使用参考图 1 作为场景坐标参考。',
      '使用参考图 2 作为要放入场景的人物参考，尽量保持人物外观一致。',
      referenceDescription,
      `请把参考图 2 中的人物放到参考网格坐标 (${input.target.x}, ${input.target.y})。`,
      `网格共有 ${input.grid.columns} 个 X 列、${input.grid.rows} 个 Y 行。坐标 (1,1) 是左上角格子；X 向右递增，Y 向下递增。`,
      '只输出一张自然的最终场景图。输出图中不得出现任何网格线、坐标标签、坐标轴、标记点、界面文字、字幕、水印、箭头或注释。',
      '尽量保持原场景透视、光照和比例，让人物在目标坐标处看起来物理合理。',
      '用户提示词：',
      input.userPrompt,
    ].join('\n')
  }

  const referenceDescription = input.referenceMode === 'outer_axes'
    ? 'Reference image 1 is the original scene with X labels above the image and Y labels on the left margin. The scene pixels themselves are intentionally unmarked.'
    : 'Reference image 1 is the scene with an overlaid coordinate grid and coordinate labels.'

  return [
    'Use reference image 1 as the scene coordinate reference.',
    'Use reference image 2 as the exact character/person reference.',
    referenceDescription,
    `Place the person from reference image 2 at coordinate (${input.target.x}, ${input.target.y}) on the reference grid.`,
    `The grid has ${input.grid.columns} X columns and ${input.grid.rows} Y rows. Coordinate (1,1) is the top-left cell; X increases to the right and Y increases downward.`,
    'Return one natural final scene image only. Do not include any grid lines, coordinate labels, axes, markers, UI text, subtitles, watermarks, arrows, or annotations in the output image.',
    'Preserve the scene perspective, lighting, and scale as much as possible while making the person physically plausible at the requested coordinate.',
    'User prompt:',
    input.userPrompt,
  ].join('\n')
}
