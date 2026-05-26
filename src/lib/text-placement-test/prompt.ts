import type { Locale } from '@/i18n/routing'
import type { TextPlacementPlan, TextPlacementShot, TextPlacementTestRunRequest } from '@/lib/text-placement-test/types'

export function buildTextPlacementPlanPrompt(input: TextPlacementTestRunRequest, locale: Locale): string {
  if (locale === 'zh') {
    return [
      '你是影视美术和摄影调度规划师。请根据剧情，为图像生成测试设计一组连续镜头的“文字绝对定位”方案。',
      '目标不是输出坐标，而是用自然语言严格定位每个镜头里的人物站位、相对锚点、画面位置、前中背景层次和禁止位置。',
      '只返回 JSON，不要 markdown，不要解释。',
      '字段要求：',
      'sceneBrief: 场景资产应该长什么样。',
      'characterBrief: 人物资产应该长什么样。',
      'shots: 5 到 10 个连续镜头。shotNumber 必须从 1 开始连续递增。',
      '每个 shot 需要包含：shotLabel、absoluteLocation、anchorObject、relationToAnchor、distanceScale、bodyFacing、screenPosition、foregroundLayer、midgroundLayer、backgroundLayer、cameraView、negativeConstraints。',
      '连续性要求：人物站位、摄影机视角和画面景别应按剧情连续推进，不要每张图都是同一个站位。',
      '资产要求：所有 shot 共享同一个场景资产和人物资产，因此 sceneBrief 与 characterBrief 必须足够稳定，能支持整组镜头。',
      'Schema:',
      '{"sceneBrief":"string","characterBrief":"string","shots":[{"shotNumber":number,"shotLabel":"string","absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string","foregroundLayer":"string","midgroundLayer":"string","backgroundLayer":"string","cameraView":"string","negativeConstraints":["string"]}]}',
      '剧情：',
      input.storyPrompt,
    ].join('\n')
  }

  return [
    'You are a film production designer and cinematography blocking planner. Design a continuous sequence of strict text-based absolute placement shots for an image-generation test from the story.',
    'The goal is not coordinates. Use natural language to strictly place the character in each shot by absolute scene zone, visible anchors, screen position, foreground/midground/background layers, and forbidden placements.',
    'Return JSON only. Do not return markdown. Do not explain.',
    'Field requirements:',
    'sceneBrief: what the generated scene asset should look like.',
    'characterBrief: what the generated character asset should look like.',
    'shots: 5 to 10 continuous shots. shotNumber must start at 1 and increase continuously.',
    'Each shot must include: shotLabel, absoluteLocation, anchorObject, relationToAnchor, distanceScale, bodyFacing, screenPosition, foregroundLayer, midgroundLayer, backgroundLayer, cameraView, negativeConstraints.',
    'Continuity requirement: character placement, camera viewpoint, and shot size should progress with the story; do not keep every image at the same placement.',
    'Asset requirement: all shots share the same scene asset and character asset, so sceneBrief and characterBrief must be stable enough for the full sequence.',
    'Schema:',
    '{"sceneBrief":"string","characterBrief":"string","shots":[{"shotNumber":number,"shotLabel":"string","absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string","foregroundLayer":"string","midgroundLayer":"string","backgroundLayer":"string","cameraView":"string","negativeConstraints":["string"]}]}',
    'Story:',
    input.storyPrompt,
  ].join('\n')
}

export function buildTextPlacementScenePrompt(plan: TextPlacementPlan, locale: Locale): string {
  const anchors = Array.from(new Set(plan.shots.map((shot) => shot.anchorObject))).join(locale === 'zh' ? '、' : ', ')
  if (locale === 'zh') {
    return [
      '生成一张干净的场景资产图，不要出现人物。',
      '场景必须包含后续整组顺序镜头定位所需的清晰可见锚点。',
      `场景说明：${plan.sceneBrief}`,
      `必须清楚可见的定位锚点：${anchors}`,
      '不要添加文字、字幕、坐标、网格、箭头、摄影机图标、水印。',
    ].join('\n')
  }

  return [
    'Generate one clean scene asset image with no person in it.',
    'The scene must contain the visible anchors needed for the later sequential character placements.',
    `Scene brief: ${plan.sceneBrief}`,
    `Required visible placement anchors: ${anchors}`,
    'Do not add text, subtitles, coordinates, grids, arrows, camera icons, or watermarks.',
  ].join('\n')
}

export function buildTextPlacementCharacterPrompt(plan: TextPlacementPlan, locale: Locale): string {
  const facingNotes = Array.from(new Set(plan.shots.map((shot) => shot.bodyFacing))).slice(0, 3).join(locale === 'zh' ? '；' : '; ')
  if (locale === 'zh') {
    return [
      '生成一张单人人物资产图，干净背景，全身或接近全身，方便后续作为人物参考。',
      `人物说明：${plan.characterBrief}`,
      `整组镜头中的身体和脸朝向参考：${facingNotes}`,
      '不要加入场景背景、文字、字幕、Logo、水印或多个人物。',
    ].join('\n')
  }

  return [
    'Generate one single-character asset image on a clean background, full body or near full body, suitable as a later person reference.',
    `Character brief: ${plan.characterBrief}`,
    `Body and face direction references across the sequence: ${facingNotes}`,
    'Do not add a scene background, text, subtitles, logos, watermarks, or multiple people.',
  ].join('\n')
}

export function buildTextPlacementFinalPrompt(input: {
  readonly storyPrompt: string
  readonly shot: TextPlacementShot
  readonly locale: Locale
}): string {
  const negativeList = input.shot.negativeConstraints.map((item) => `- ${item}`).join('\n')
  if (input.locale === 'zh') {
    return [
      `根据参考图 1 的场景资产和参考图 2 的人物资产，生成顺序镜头组中的第 ${input.shot.shotNumber} 张电影画面。`,
      '核心任务：严格按文字绝对定位描述放置人物，不使用坐标，不输出定位辅助图。',
      `当前镜头：第 ${input.shot.shotNumber} 镜，${input.shot.shotLabel}`,
      `剧情：${input.storyPrompt}`,
      `人物绝对位置：${input.shot.absoluteLocation}`,
      `定位锚点：${input.shot.anchorObject}`,
      `人物相对锚点：${input.shot.relationToAnchor}`,
      `距离和尺度：${input.shot.distanceScale}`,
      `人物朝向：${input.shot.bodyFacing}`,
      `画面位置：${input.shot.screenPosition}`,
      `前景：${input.shot.foregroundLayer}`,
      `中景：${input.shot.midgroundLayer}`,
      `背景：${input.shot.backgroundLayer}`,
      `摄影机视角：${input.shot.cameraView}`,
      '禁止项：',
      negativeList,
      '最终图不得出现文字、字幕、坐标、网格、箭头、摄影机图标、水印或调度说明。',
    ].join('\n')
  }

  return [
    `Use reference image 1 as the scene asset and reference image 2 as the character asset. Generate shot ${input.shot.shotNumber} in the sequential cinematic image set.`,
    'Core task: strictly place the character according to the text-based absolute placement description. Do not use coordinates and do not output a placement guide.',
    `Current shot: shot ${input.shot.shotNumber}, ${input.shot.shotLabel}`,
    `Story: ${input.storyPrompt}`,
    `Character absolute location: ${input.shot.absoluteLocation}`,
    `Placement anchor: ${input.shot.anchorObject}`,
    `Character relation to anchor: ${input.shot.relationToAnchor}`,
    `Distance and scale: ${input.shot.distanceScale}`,
    `Character facing: ${input.shot.bodyFacing}`,
    `Screen position: ${input.shot.screenPosition}`,
    `Foreground: ${input.shot.foregroundLayer}`,
    `Midground: ${input.shot.midgroundLayer}`,
    `Background: ${input.shot.backgroundLayer}`,
    `Camera view: ${input.shot.cameraView}`,
    'Forbidden errors:',
    negativeList,
    'Do not include text, subtitles, coordinates, grids, arrows, camera icons, watermarks, or blocking notes in the final image.',
  ].join('\n')
}
