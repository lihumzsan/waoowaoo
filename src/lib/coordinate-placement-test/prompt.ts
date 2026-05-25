import type {
  CoordinatePlacementAnalyzeRequest,
  CoordinatePlacementGenerateRequest,
  CoordinatePlacementReferenceViewsRequest,
} from '@/lib/coordinate-placement-test/types'
import type { Locale } from '@/i18n/routing'

export function buildCoordinateFloorPlanPrompt(input: CoordinatePlacementReferenceViewsRequest, locale: Locale): string {
  if (locale === 'zh') {
    return [
      '根据参考图生成一张干净的 2D 俯视平面图，用于后续坐标网格和摄影机调度测试。',
      '要求：纯俯视、正交视角、不要透视镜头、不要人物、不要摄影机、不要网格、不要坐标、不要文字标签。',
      '保留原场景的主要空间结构、入口、墙体、家具、道路、窗户、桌椅等可定位锚点。',
      '输出只能是一张 2D 平面图，不要做分屏，不要生成三视图。',
      '用户场景/剧情说明：',
      input.userPrompt,
    ].join('\n')
  }

  return [
    'Generate one clean 2D top-down floor plan from the reference image for later coordinate-grid and camera-blocking tests.',
    'Requirements: pure orthographic top-down view, no perspective camera, no people, no camera icons, no grid, no coordinates, no text labels.',
    'Preserve the main spatial structure, entrances, walls, furniture, roads, windows, tables, chairs, and other positionable anchors from the original scene.',
    'Output only one 2D floor plan. Do not create a split sheet and do not create three views.',
    'User scene/story note:',
    input.userPrompt,
  ].join('\n')
}

export function buildCoordinateThreeViewPrompt(input: CoordinatePlacementReferenceViewsRequest, locale: Locale): string {
  if (locale === 'zh') {
    return [
      '根据参考图生成一张三视图参考图，三视图必须包含在同一张图片内。',
      '同一张图片中清晰分成三个区域：正视图、侧视图、背视图或等价的前/侧/后空间外观参考。',
      '目标是帮助后续图像模型理解场景的高度、墙面、门窗、家具立面和空间风格。',
      '不要加入人物、摄影机图标、箭头、坐标网格、界面文字、水印或无关注释。',
      '保持材质、色彩、光照氛围和主要空间识别特征与参考图一致。',
      '用户场景/剧情说明：',
      input.userPrompt,
    ].join('\n')
  }

  return [
    'Generate one three-view reference sheet from the reference image. All three views must be contained in a single image.',
    'Clearly divide the image into three regions: front view, side view, and rear view, or equivalent front/side/back spatial appearance references.',
    'The goal is to help the later image model understand scene height, walls, doors, windows, furniture elevations, and spatial style.',
    'Do not add people, camera icons, arrows, coordinate grids, UI text, watermarks, or unrelated annotations.',
    'Keep materials, color, lighting mood, and the main recognizable spatial features consistent with the reference image.',
    'User scene/story note:',
    input.userPrompt,
  ].join('\n')
}

export function buildCoordinateAnalysisPrompt(input: CoordinatePlacementAnalyzeRequest, locale: Locale): string {
  if (locale === 'zh') {
    const referenceDescription = input.referenceMode === 'outer_axes'
      ? '参考图是原始 2D 平面图，图片上方有 X 坐标标签，图片左侧留白处有 Y 坐标标签；场景图片本身没有网格线。'
      : '参考图是叠加了坐标网格和坐标标签的 2D 平面图。'

    return [
      '你是 2D 平面图上的摄影调度规划器。请根据用户剧情和参考图输出一个严格 JSON 对象。',
      referenceDescription,
      `网格共有 ${input.grid.columns} 个 X 列、${input.grid.rows} 个 Y 行。坐标 (1,1) 是左上角格子；X 向右递增，Y 向下递增。`,
      '任务：选择人物应该站立的网格坐标、摄影机所在网格坐标，以及摄影机镜头朝向。',
      'cameraFacing 只能使用：north, northeast, east, southeast, south, southwest, west, northwest。',
      '不要输出 markdown，不要解释，只返回 JSON。',
      'Schema:',
      '{"person":{"x":number,"y":number},"camera":{"x":number,"y":number},"cameraFacing":"north|northeast|east|southeast|south|southwest|west|northwest","shotIntent":"string"}',
      '用户剧情/测试要求：',
      input.userPrompt,
    ].join('\n')
  }

  const referenceDescription = input.referenceMode === 'outer_axes'
    ? 'The reference is the original 2D floor plan with X labels above the image and Y labels on the left margin; the scene pixels themselves have no grid lines.'
    : 'The reference is a 2D floor plan with overlaid coordinate grid lines and coordinate labels.'

  return [
    'You are a cinematography planner on a 2D floor plan. Return one strict JSON object based on the user story and reference image.',
    referenceDescription,
    `The grid has ${input.grid.columns} X columns and ${input.grid.rows} Y rows. Coordinate (1,1) is the top-left cell; X increases to the right and Y increases downward.`,
    'Task: choose the grid coordinate where the person should stand, the grid coordinate where the camera should be placed, and the camera facing direction.',
    'cameraFacing must be one of: north, northeast, east, southeast, south, southwest, west, northwest.',
    'Do not return markdown. Do not explain. Return JSON only.',
    'Schema:',
    '{"person":{"x":number,"y":number},"camera":{"x":number,"y":number},"cameraFacing":"north|northeast|east|southeast|south|southwest|west|northwest","shotIntent":"string"}',
    'User story/test request:',
    input.userPrompt,
  ].join('\n')
}

export function buildCoordinateCameraGenerationPrompt(input: CoordinatePlacementGenerateRequest, locale: Locale): string {
  const analysis = input.analysis
  if (locale === 'zh') {
    return [
      '使用参考图 1 作为摄影机机位参考图。参考图 1 是无网格的 2D 平面图，上面的 📷 图标表示摄影机位置，箭头表示摄影机镜头朝向。',
      '使用参考图 2 作为三视图场景参考。参考图 2 包含同一场景的正视图、侧视图、背视图或等价前/侧/后空间外观，用于理解墙面高度、门窗、家具立面和场景风格。',
      '使用参考图 3 作为要放入场景的人物参考，尽量保持人物外观一致。',
      `人物目标位置是网格坐标 (${analysis.person.x}, ${analysis.person.y})。`,
      `摄影机位置是网格坐标 (${analysis.camera.x}, ${analysis.camera.y})，镜头朝向 ${analysis.cameraFacing}。`,
      `镜头意图：${analysis.shotIntent}`,
      '请根据摄影机机位和镜头朝向，输出一张自然的最终场景图。',
      '输出图中不得出现摄影机图标、箭头、网格线、坐标标签、坐标轴、标记点、界面文字、字幕、水印或注释。',
      '尽量保持原场景空间关系、光照和比例，让人物在目标位置看起来物理合理。',
      '用户补充提示词：',
      input.userPrompt,
    ].join('\n')
  }

  return [
    'Use reference image 1 as the camera placement reference. Reference image 1 is an ungridded 2D floor plan; the 📷 icon marks the camera position, and the arrow marks the camera facing direction.',
    'Use reference image 2 as the three-view scene reference. It contains front, side, and rear views, or equivalent front/side/back spatial appearance references, to understand wall height, doors, windows, furniture elevations, and scene style.',
    'Use reference image 3 as the exact character/person reference.',
    `The person target position is grid coordinate (${analysis.person.x}, ${analysis.person.y}).`,
    `The camera position is grid coordinate (${analysis.camera.x}, ${analysis.camera.y}), facing ${analysis.cameraFacing}.`,
    `Shot intent: ${analysis.shotIntent}`,
    'Generate one natural final scene image from that camera position and facing direction.',
    'Do not include the camera icon, arrows, grid lines, coordinate labels, axes, markers, UI text, subtitles, watermarks, or annotations in the output image.',
    'Preserve the scene spatial relationship, lighting, and scale as much as possible while making the person physically plausible at the target position.',
    'Additional user prompt:',
    input.userPrompt,
  ].join('\n')
}
