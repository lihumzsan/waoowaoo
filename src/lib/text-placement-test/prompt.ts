import type { Locale } from '@/i18n/routing'
import type { TextPlacementPlan, TextPlacementTestRunRequest } from '@/lib/text-placement-test/types'

export function buildTextPlacementPlanPrompt(input: TextPlacementTestRunRequest, locale: Locale): string {
  if (locale === 'zh') {
    return [
      '你是影视美术和摄影调度规划师。请根据剧情，为图像生成测试设计一个严格的“文字绝对定位”方案。',
      '目标不是输出坐标，而是用自然语言严格定位人物站位、相对锚点、画面位置、前中背景层次和禁止位置。',
      '只返回 JSON，不要 markdown，不要解释。',
      '字段要求：',
      'sceneBrief: 场景资产应该长什么样。',
      'characterBrief: 人物资产应该长什么样。',
      'absoluteLocation: 人物在场景里的绝对区域，例如“房间中央偏右、靠近后墙前三步”。',
      'anchorObject: 用来定位人物的最重要可见锚点。',
      'relationToAnchor: 人物相对锚点的位置、距离和遮挡关系。',
      'distanceScale: 人物和摄影机、墙面、锚点的距离/尺度说明。',
      'bodyFacing: 人物身体和脸朝向。',
      'screenPosition: 人物在最终画面里的九宫格/三分法位置和占画面比例。',
      'foregroundLayer/midgroundLayer/backgroundLayer: 最终画面的前景、中景、背景分别是什么。',
      'cameraView: 摄影机视角、景别、高度和镜头语言。',
      'negativeConstraints: 3 到 10 条禁止项，明确人物不能站在哪里、不能被什么遮挡、不能出现什么错误构图。',
      'Schema:',
      '{"sceneBrief":"string","characterBrief":"string","absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string","foregroundLayer":"string","midgroundLayer":"string","backgroundLayer":"string","cameraView":"string","negativeConstraints":["string"]}',
      '剧情：',
      input.storyPrompt,
    ].join('\n')
  }

  return [
    'You are a film production designer and cinematography blocking planner. Design one strict text-based absolute placement plan for an image-generation test from the story.',
    'The goal is not coordinates. Use natural language to strictly place the character by absolute scene zone, visible anchors, screen position, foreground/midground/background layers, and forbidden placements.',
    'Return JSON only. Do not return markdown. Do not explain.',
    'Field requirements:',
    'sceneBrief: what the generated scene asset should look like.',
    'characterBrief: what the generated character asset should look like.',
    'absoluteLocation: the character absolute zone inside the scene, such as "center-right of the room, three steps in front of the back wall".',
    'anchorObject: the most important visible anchor object used for placement.',
    'relationToAnchor: character position, distance, and occlusion relation relative to the anchor.',
    'distanceScale: distance/scale relation between character, camera, walls, and anchor.',
    'bodyFacing: body and face direction.',
    'screenPosition: nine-grid/thirds screen position and approximate frame occupancy.',
    'foregroundLayer/midgroundLayer/backgroundLayer: what appears in the final image foreground, midground, and background.',
    'cameraView: camera viewpoint, shot size, height, and lens language.',
    'negativeConstraints: 3 to 10 forbidden placement/composition errors.',
    'Schema:',
    '{"sceneBrief":"string","characterBrief":"string","absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string","foregroundLayer":"string","midgroundLayer":"string","backgroundLayer":"string","cameraView":"string","negativeConstraints":["string"]}',
    'Story:',
    input.storyPrompt,
  ].join('\n')
}

export function buildTextPlacementScenePrompt(plan: TextPlacementPlan, locale: Locale): string {
  if (locale === 'zh') {
    return [
      '生成一张干净的场景资产图，不要出现人物。',
      '场景必须包含后续人物定位所需的清晰可见锚点。',
      `场景说明：${plan.sceneBrief}`,
      `必须清楚可见的定位锚点：${plan.anchorObject}`,
      `前景层：${plan.foregroundLayer}`,
      `中景层：${plan.midgroundLayer}`,
      `背景层：${plan.backgroundLayer}`,
      '不要添加文字、字幕、坐标、网格、箭头、摄影机图标、水印。',
    ].join('\n')
  }

  return [
    'Generate one clean scene asset image with no person in it.',
    'The scene must contain the visible anchor needed for later character placement.',
    `Scene brief: ${plan.sceneBrief}`,
    `Required visible placement anchor: ${plan.anchorObject}`,
    `Foreground layer: ${plan.foregroundLayer}`,
    `Midground layer: ${plan.midgroundLayer}`,
    `Background layer: ${plan.backgroundLayer}`,
    'Do not add text, subtitles, coordinates, grids, arrows, camera icons, or watermarks.',
  ].join('\n')
}

export function buildTextPlacementCharacterPrompt(plan: TextPlacementPlan, locale: Locale): string {
  if (locale === 'zh') {
    return [
      '生成一张单人人物资产图，干净背景，全身或接近全身，方便后续作为人物参考。',
      `人物说明：${plan.characterBrief}`,
      `身体和脸朝向参考：${plan.bodyFacing}`,
      '不要加入场景背景、文字、字幕、Logo、水印或多个人物。',
    ].join('\n')
  }

  return [
    'Generate one single-character asset image on a clean background, full body or near full body, suitable as a later person reference.',
    `Character brief: ${plan.characterBrief}`,
    `Body and face direction reference: ${plan.bodyFacing}`,
    'Do not add a scene background, text, subtitles, logos, watermarks, or multiple people.',
  ].join('\n')
}

export function buildTextPlacementFinalPrompt(input: {
  readonly storyPrompt: string
  readonly plan: TextPlacementPlan
  readonly locale: Locale
}): string {
  const negativeList = input.plan.negativeConstraints.map((item) => `- ${item}`).join('\n')
  if (input.locale === 'zh') {
    return [
      '根据参考图 1 的场景资产和参考图 2 的人物资产，生成一张最终电影画面。',
      '核心任务：严格按文字绝对定位描述放置人物，不使用坐标，不输出定位辅助图。',
      `剧情：${input.storyPrompt}`,
      `人物绝对位置：${input.plan.absoluteLocation}`,
      `定位锚点：${input.plan.anchorObject}`,
      `人物相对锚点：${input.plan.relationToAnchor}`,
      `距离和尺度：${input.plan.distanceScale}`,
      `人物朝向：${input.plan.bodyFacing}`,
      `画面位置：${input.plan.screenPosition}`,
      `前景：${input.plan.foregroundLayer}`,
      `中景：${input.plan.midgroundLayer}`,
      `背景：${input.plan.backgroundLayer}`,
      `摄影机视角：${input.plan.cameraView}`,
      '禁止项：',
      negativeList,
      '最终图不得出现文字、字幕、坐标、网格、箭头、摄影机图标、水印或调度说明。',
    ].join('\n')
  }

  return [
    'Use reference image 1 as the scene asset and reference image 2 as the character asset. Generate one final cinematic image.',
    'Core task: strictly place the character according to the text-based absolute placement description. Do not use coordinates and do not output a placement guide.',
    `Story: ${input.storyPrompt}`,
    `Character absolute location: ${input.plan.absoluteLocation}`,
    `Placement anchor: ${input.plan.anchorObject}`,
    `Character relation to anchor: ${input.plan.relationToAnchor}`,
    `Distance and scale: ${input.plan.distanceScale}`,
    `Character facing: ${input.plan.bodyFacing}`,
    `Screen position: ${input.plan.screenPosition}`,
    `Foreground: ${input.plan.foregroundLayer}`,
    `Midground: ${input.plan.midgroundLayer}`,
    `Background: ${input.plan.backgroundLayer}`,
    `Camera view: ${input.plan.cameraView}`,
    'Forbidden errors:',
    negativeList,
    'Do not include text, subtitles, coordinates, grids, arrows, camera icons, watermarks, or blocking notes in the final image.',
  ].join('\n')
}
