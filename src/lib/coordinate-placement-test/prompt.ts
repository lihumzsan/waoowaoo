import type {
  CoordinatePlacementAnalyzeRequest,
  CoordinatePlacementGenerateRequest,
  CoordinatePlacementReferenceViewsRequest,
} from '@/lib/coordinate-placement-test/types'
import type { Locale } from '@/i18n/routing'

function readPromptNote(input: { readonly userPrompt: string }, locale: Locale): string {
  const trimmed = input.userPrompt.trim()
  if (trimmed) return trimmed
  return locale === 'zh'
    ? '无额外用户提示；请基于参考图本身自动规划测试内容。'
    : 'No extra user prompt; automatically plan the test content from the reference image itself.'
}

export function buildCoordinateFloorPlanPrompt(input: CoordinatePlacementReferenceViewsRequest, locale: Locale): string {
  const promptNote = readPromptNote(input, locale)
  if (locale === 'zh') {
    return [
      '根据参考图生成一张干净的 2D 俯视平面图，用于后续坐标网格和摄影机调度测试。',
      '要求：纯俯视、正交视角、不要透视镜头、不要人物、不要摄影机、不要网格、不要坐标、不要文字标签。',
      '保留原场景的主要空间结构、入口、墙体、家具、道路、窗户、桌椅等可定位锚点。',
      '输出只能是一张 2D 平面图，不要做分屏，不要生成三视图。',
      '场景/测试说明：',
      promptNote,
    ].join('\n')
  }

  return [
    'Generate one clean 2D top-down floor plan from the reference image for later coordinate-grid and camera-blocking tests.',
    'Requirements: pure orthographic top-down view, no perspective camera, no people, no camera icons, no grid, no coordinates, no text labels.',
    'Preserve the main spatial structure, entrances, walls, furniture, roads, windows, tables, chairs, and other positionable anchors from the original scene.',
    'Output only one 2D floor plan. Do not create a split sheet and do not create three views.',
    'Scene/test note:',
    promptNote,
  ].join('\n')
}

export function buildCoordinateThreeViewPrompt(input: CoordinatePlacementReferenceViewsRequest, locale: Locale): string {
  const promptNote = readPromptNote(input, locale)
  if (locale === 'zh') {
    return [
      '根据参考图生成一张三视图参考图，三视图必须包含在同一张图片内。',
      '同一张图片中清晰分成三个区域：正视图、侧视图、背视图或等价的前/侧/后空间外观参考。',
      '目标是帮助后续图像模型理解场景的高度、墙面、门窗、家具立面和空间风格。',
      '不要加入人物、摄影机图标、箭头、坐标网格、界面文字、水印或无关注释。',
      '保持材质、色彩、光照氛围和主要空间识别特征与参考图一致。',
      '场景/测试说明：',
      promptNote,
    ].join('\n')
  }

  return [
    'Generate one three-view reference sheet from the reference image. All three views must be contained in a single image.',
    'Clearly divide the image into three regions: front view, side view, and rear view, or equivalent front/side/back spatial appearance references.',
    'The goal is to help the later image model understand scene height, walls, doors, windows, furniture elevations, and spatial style.',
    'Do not add people, camera icons, arrows, coordinate grids, UI text, watermarks, or unrelated annotations.',
    'Keep materials, color, lighting mood, and the main recognizable spatial features consistent with the reference image.',
    'Scene/test note:',
    promptNote,
  ].join('\n')
}

export function buildCoordinateAnalysisPrompt(input: CoordinatePlacementAnalyzeRequest, locale: Locale): string {
  const promptNote = readPromptNote(input, locale)
  if (locale === 'zh') {
    const referenceDescription = input.referenceMode === 'outer_axes'
      ? '参考图是原始 2D 平面图，图片上方有 X 坐标标签，图片左侧留白处有 Y 坐标标签；场景图片本身没有网格线。'
      : '参考图是叠加了坐标网格和坐标标签的 2D 平面图。'

    return [
      '你是 2D 平面图上的连续镜头摄影调度规划器。请根据参考图自动输出一组连续镜头的严格 JSON 对象。',
      referenceDescription,
      `网格共有 ${input.grid.columns} 个 X 列、${input.grid.rows} 个 Y 行。坐标 (1,1) 是左上角格子；X 向右递增，Y 向下递增。`,
      '任务：规划 5 到 10 个连续镜头。每个镜头都要选择人物站立网格坐标、摄影机所在网格坐标，以及摄影机镜头朝向。',
      '连续性要求：镜头之间的人物位置和摄影机位置应形成可测试的连续移动，不要每个镜头都放在同一个坐标；同时不要跳到明显不连贯的远端位置。',
      '覆盖要求：镜头组应覆盖不同距离、不同方向和不同人物站位，让测试能观察模型是否持续遵循坐标。',
      'cameraFacing 只能使用：north, northeast, east, southeast, south, southwest, west, northwest。',
      '不要输出 markdown，不要解释，只返回 JSON。',
      'Schema:',
      '{"shots":[{"shotNumber":number,"shotLabel":"string","person":{"x":number,"y":number},"camera":{"x":number,"y":number},"cameraFacing":"north|northeast|east|southeast|south|southwest|west|northwest","shotIntent":"string"}]}',
      'shotNumber 必须从 1 开始连续递增。shotLabel 用短标题描述镜头，例如“入口建立”“中景跟随”“近景对话”。',
      '额外测试说明：',
      promptNote,
    ].join('\n')
  }

  const referenceDescription = input.referenceMode === 'outer_axes'
    ? 'The reference is the original 2D floor plan with X labels above the image and Y labels on the left margin; the scene pixels themselves have no grid lines.'
    : 'The reference is a 2D floor plan with overlaid coordinate grid lines and coordinate labels.'

  return [
    'You are a continuous-shot cinematography planner on a 2D floor plan. Return one strict JSON object based on the reference image.',
    referenceDescription,
    `The grid has ${input.grid.columns} X columns and ${input.grid.rows} Y rows. Coordinate (1,1) is the top-left cell; X increases to the right and Y increases downward.`,
    'Task: plan 5 to 10 continuous shots. For each shot, choose the grid coordinate where the person should stand, the grid coordinate where the camera should be placed, and the camera facing direction.',
    'Continuity requirement: person and camera positions should form a testable continuous movement across shots; do not keep every shot on the same coordinates, and do not jump to obviously unrelated far locations.',
    'Coverage requirement: cover different distances, directions, and person placements so the test can observe whether the model follows coordinates over time.',
    'cameraFacing must be one of: north, northeast, east, southeast, south, southwest, west, northwest.',
    'Do not return markdown. Do not explain. Return JSON only.',
    'Schema:',
    '{"shots":[{"shotNumber":number,"shotLabel":"string","person":{"x":number,"y":number},"camera":{"x":number,"y":number},"cameraFacing":"north|northeast|east|southeast|south|southwest|west|northwest","shotIntent":"string"}]}',
    'shotNumber must start at 1 and increase continuously. shotLabel is a short title such as "establishing entrance", "medium follow", or "close dialogue".',
    'Extra test note:',
    promptNote,
  ].join('\n')
}

export function buildCoordinateCameraGenerationPrompt(input: CoordinatePlacementGenerateRequest, locale: Locale): string {
  const analysis = input.analysis
  const promptNote = readPromptNote(input, locale)
  if (locale === 'zh') {
    const shared = [
      '参考图 1 是摄影机机位示意图，只用于读取空间布局、摄影机位置和镜头朝向。它不是最终画面背景，绝对不要把这张 2D 平面图直接画进输出。',
      '参考图 2 是三视图场景参考，用于理解墙面高度、门窗、家具立面、材质、光照和空间风格。',
      '参考图 3 是人物外观参考，尽量保持人物外观一致。',
      `当前镜头：第 ${analysis.shotNumber} 镜，${analysis.shotLabel}。`,
      `人物目标位置：网格坐标 (${analysis.person.x}, ${analysis.person.y})。`,
      `摄影机位置：网格坐标 (${analysis.camera.x}, ${analysis.camera.y})，镜头朝向 ${analysis.cameraFacing}。`,
      `镜头意图：${analysis.shotIntent}`,
      '输出图中不得出现摄影机图标、箭头、网格线、坐标标签、坐标轴、俯视平面图、界面文字、字幕、水印或注释。',
    ]
    const variantLines: Record<CoordinatePlacementGenerateRequest['promptVariant'], readonly string[]> = {
      camera_ray_cast: [
        '把参考图 1 当作一张“建筑平面图”。请想象摄影机站在 📷 所在格子，从箭头方向沿视线向前看。',
        '沿这条视线把 2D 平面关系转换为真实 3D 透视画面：近处物体更大，远处物体更小，墙面、地面、门窗要有真实透视。',
        '最终画面必须像真实摄影机从该位置拍摄出来，而不是俯视图、地图、剖面图或平面图。',
      ],
      reconstruct_3d: [
        '先在脑中根据参考图 1 的布局和参考图 2 的三视图重建一个完整 3D 场景。',
        '重建完成后，删除所有图标和辅助线，只从摄影机位置与朝向渲染一张真实透视照片。',
        '如果 2D 平面图和三视图冲突，以三视图的立面/高度/材质为准，以 2D 图的位置关系为准。',
      ],
      director_blocking: [
        '请按电影导演的分镜调度执行：人物站在目标坐标，摄影机站在摄影机坐标，镜头朝向指定方向。',
        '画面需要是正常电影镜头，可见地面延伸、墙面立起、空间纵深和人物所在位置。',
        '参考图 1 只是一张场面调度图，不是美术背景，不要照抄它的俯视构图。',
      ],
      strict_not_map: [
        '强约束：不要输出 top-down view、floor plan、map view、orthographic view、diagram、blueprint、layout drawing。',
        '必须输出 ground-level 或 eye-level 的透视场景画面，从摄影机箭头方向看过去。',
        '如果模型不确定空间细节，也必须保持摄影机视角，不允许退回到俯视平面图。',
      ],
    }
    return [
      ...shared,
      ...variantLines[input.promptVariant],
      '额外测试说明：',
      promptNote,
    ].join('\n')
  }

  const shared = [
    'Reference image 1 is a camera blocking diagram only. Use it to read spatial layout, camera position, and facing direction. It is not the final image background; do not copy the 2D floor plan into the output.',
    'Reference image 2 is the three-view scene reference for wall height, doors, windows, furniture elevations, materials, lighting, and spatial style.',
    'Reference image 3 is the exact character/person appearance reference.',
    `Current shot: shot ${analysis.shotNumber}, ${analysis.shotLabel}.`,
    `Person target position: grid coordinate (${analysis.person.x}, ${analysis.person.y}).`,
    `Camera position: grid coordinate (${analysis.camera.x}, ${analysis.camera.y}), facing ${analysis.cameraFacing}.`,
    `Shot intent: ${analysis.shotIntent}`,
    'Do not include the camera icon, arrows, grid lines, coordinate labels, axes, top-down floor plan, UI text, subtitles, watermarks, or annotations in the output image.',
  ]
  const variantLines: Record<CoordinatePlacementGenerateRequest['promptVariant'], readonly string[]> = {
    camera_ray_cast: [
      'Treat reference image 1 as an architectural plan. Imagine the camera standing on the 📷 cell and looking along the arrow direction.',
      'Convert the 2D plan into a true 3D perspective view along that sight line: near objects larger, far objects smaller, walls and floor with real perspective.',
      'The final image must look photographed from that camera location, not like a top-down map, section, diagram, or floor plan.',
    ],
    reconstruct_3d: [
      'First mentally reconstruct a complete 3D scene from reference image 1 layout and reference image 2 three-view sheet.',
      'After reconstruction, remove all icons and guides, then render one realistic perspective image from the camera position and facing direction.',
      'If the floor plan and three-view sheet conflict, use the three-view sheet for elevation/height/materials and the floor plan for spatial positions.',
    ],
    director_blocking: [
      'Execute this as a film director blocking note: person at the target coordinate, camera at the camera coordinate, lens facing the specified direction.',
      'The image should be a normal cinematic shot with visible floor depth, upright walls, spatial depth, and the person placed in the intended location.',
      'Reference image 1 is only a blocking diagram, not an art background; do not mimic its top-down composition.',
    ],
    strict_not_map: [
      'Hard constraint: do not output a top-down view, floor plan, map view, orthographic view, diagram, blueprint, or layout drawing.',
      'You must output a ground-level or eye-level perspective scene from the camera arrow direction.',
      'If spatial details are uncertain, still preserve the camera viewpoint; never fall back to a top-down floor plan.',
    ],
  }
  return [
    ...shared,
    ...variantLines[input.promptVariant],
    'Extra test note:',
    promptNote,
  ].join('\n')
}
