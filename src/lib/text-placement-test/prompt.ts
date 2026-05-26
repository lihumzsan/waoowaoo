import type { Locale } from '@/i18n/routing'
import type { TextPlacementCharacterPlacement, TextPlacementPlan, TextPlacementShot, TextPlacementTestRunRequest } from '@/lib/text-placement-test/types'

type TextPlacementCharacterKey = 'A' | 'B'

function readCharacterBrief(plan: TextPlacementPlan, characterKey: TextPlacementCharacterKey): string {
  return characterKey === 'A' ? plan.characterABrief : plan.characterBBrief
}

function readShotPlacement(shot: TextPlacementShot, characterKey: TextPlacementCharacterKey): TextPlacementCharacterPlacement {
  return characterKey === 'A' ? shot.characterAPlacement : shot.characterBPlacement
}

export function buildTextPlacementPlanPrompt(input: TextPlacementTestRunRequest, locale: Locale): string {
  if (locale === 'zh') {
    return [
      '你是影视美术和摄影调度规划师。请根据剧情，为图像生成测试设计一组连续镜头的“双人物文字绝对定位”方案。',
      '目标不是输出坐标，而是用自然语言严格定位每个镜头里人物 A、人物 B 的各自站位、相对锚点、两人关系、画面位置、前中背景层次和禁止位置。',
      '只返回 JSON，不要 markdown，不要解释。',
      '字段要求：',
      'sceneBrief: 场景资产应该长什么样。',
      'characterABrief: 人物 A 资产应该长什么样，必须和人物 B 外观明显不同。',
      'characterBBrief: 人物 B 资产应该长什么样，必须和人物 A 外观明显不同。',
      'shots: 5 到 10 个连续镜头。shotNumber 必须从 1 开始连续递增。',
      '每个 shot 需要包含：shotLabel、characterAPlacement、characterBPlacement、relationshipBetweenCharacters、foregroundLayer、midgroundLayer、backgroundLayer、cameraView、negativeConstraints。',
      'characterAPlacement 和 characterBPlacement 都必须包含 absoluteLocation、anchorObject、relationToAnchor、distanceScale、bodyFacing、screenPosition。',
      '连续性要求：人物 A、人物 B 的站位关系、摄影机视角和画面景别应按剧情连续推进，不要每张图都是同一个站位。',
      '资产要求：所有 shot 共享同一个场景资产、人物 A 资产、人物 B 资产，因此三个资产说明必须稳定，能支持整组镜头。',
      'Schema:',
      '{"sceneBrief":"string","characterABrief":"string","characterBBrief":"string","shots":[{"shotNumber":number,"shotLabel":"string","characterAPlacement":{"absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string"},"characterBPlacement":{"absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string"},"relationshipBetweenCharacters":"string","foregroundLayer":"string","midgroundLayer":"string","backgroundLayer":"string","cameraView":"string","negativeConstraints":["string"]}]}',
      '剧情：',
      input.storyPrompt,
    ].join('\n')
  }

  return [
    'You are a film production designer and cinematography blocking planner. Design a continuous sequence of strict two-character text-based absolute placement shots for an image-generation test from the story.',
    'The goal is not coordinates. Use natural language to strictly place character A and character B in each shot by separate absolute scene zones, visible anchors, relationship between them, screen positions, foreground/midground/background layers, and forbidden placements.',
    'Return JSON only. Do not return markdown. Do not explain.',
    'Field requirements:',
    'sceneBrief: what the generated scene asset should look like.',
    'characterABrief: what character A should look like. Character A must be visually distinct from character B.',
    'characterBBrief: what character B should look like. Character B must be visually distinct from character A.',
    'shots: 5 to 10 continuous shots. shotNumber must start at 1 and increase continuously.',
    'Each shot must include: shotLabel, characterAPlacement, characterBPlacement, relationshipBetweenCharacters, foregroundLayer, midgroundLayer, backgroundLayer, cameraView, negativeConstraints.',
    'Both characterAPlacement and characterBPlacement must include absoluteLocation, anchorObject, relationToAnchor, distanceScale, bodyFacing, and screenPosition.',
    'Continuity requirement: character A placement, character B placement, their relationship, camera viewpoint, and shot size should progress with the story; do not keep every image at the same placement.',
    'Asset requirement: all shots share the same scene asset, character A asset, and character B asset, so all three asset briefs must be stable enough for the full sequence.',
    'Schema:',
    '{"sceneBrief":"string","characterABrief":"string","characterBBrief":"string","shots":[{"shotNumber":number,"shotLabel":"string","characterAPlacement":{"absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string"},"characterBPlacement":{"absoluteLocation":"string","anchorObject":"string","relationToAnchor":"string","distanceScale":"string","bodyFacing":"string","screenPosition":"string"},"relationshipBetweenCharacters":"string","foregroundLayer":"string","midgroundLayer":"string","backgroundLayer":"string","cameraView":"string","negativeConstraints":["string"]}]}',
    'Story:',
    input.storyPrompt,
  ].join('\n')
}

export function buildTextPlacementScenePrompt(plan: TextPlacementPlan, locale: Locale): string {
  const anchors = Array.from(new Set(plan.shots.flatMap((shot) => [
    shot.characterAPlacement.anchorObject,
    shot.characterBPlacement.anchorObject,
  ]))).join(locale === 'zh' ? '、' : ', ')
  if (locale === 'zh') {
    return [
      '生成一张干净的场景资产图，不要出现人物。',
      '场景必须包含后续整组双人物顺序镜头定位所需的清晰可见锚点。',
      `场景说明：${plan.sceneBrief}`,
      `必须清楚可见的定位锚点：${anchors}`,
      '不要添加文字、字幕、坐标、网格、箭头、摄影机图标、水印。',
    ].join('\n')
  }

  return [
    'Generate one clean scene asset image with no person in it.',
    'The scene must contain the visible anchors needed for the later sequential two-character placements.',
    `Scene brief: ${plan.sceneBrief}`,
    `Required visible placement anchors: ${anchors}`,
    'Do not add text, subtitles, coordinates, grids, arrows, camera icons, or watermarks.',
  ].join('\n')
}

export function buildTextPlacementCharacterPrompt(plan: TextPlacementPlan, locale: Locale, characterKey: TextPlacementCharacterKey): string {
  const facingNotes = Array.from(new Set(plan.shots.map((shot) => readShotPlacement(shot, characterKey).bodyFacing))).slice(0, 3).join(locale === 'zh' ? '；' : '; ')
  const otherCharacterKey = characterKey === 'A' ? 'B' : 'A'
  if (locale === 'zh') {
    return [
      `生成一张人物 ${characterKey} 的单人人物资产图，干净背景，全身或接近全身，方便后续作为人物 ${characterKey} 参考。`,
      `人物 ${characterKey} 说明：${readCharacterBrief(plan, characterKey)}`,
      `整组镜头中的身体和脸朝向参考：${facingNotes}`,
      `不要出现人物 ${otherCharacterKey}。不要加入场景背景、文字、字幕、Logo、水印或多个人物。`,
    ].join('\n')
  }

  return [
    `Generate one single-character asset image for character ${characterKey} on a clean background, full body or near full body, suitable as the later character ${characterKey} reference.`,
    `Character ${characterKey} brief: ${readCharacterBrief(plan, characterKey)}`,
    `Body and face direction references across the sequence: ${facingNotes}`,
    `Do not include character ${otherCharacterKey}. Do not add a scene background, text, subtitles, logos, watermarks, or multiple people.`,
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
      `根据参考图 1 的场景资产、参考图 2 的人物 A 资产、参考图 3 的人物 B 资产，生成顺序镜头组中的第 ${input.shot.shotNumber} 张电影画面。`,
      '核心任务：严格按文字绝对定位描述同时放置人物 A 和人物 B，不使用坐标，不输出定位辅助图。',
      `当前镜头：第 ${input.shot.shotNumber} 镜，${input.shot.shotLabel}`,
      `剧情：${input.storyPrompt}`,
      `人物 A 绝对位置：${input.shot.characterAPlacement.absoluteLocation}`,
      `人物 A 定位锚点：${input.shot.characterAPlacement.anchorObject}`,
      `人物 A 相对锚点：${input.shot.characterAPlacement.relationToAnchor}`,
      `人物 A 距离和尺度：${input.shot.characterAPlacement.distanceScale}`,
      `人物 A 朝向：${input.shot.characterAPlacement.bodyFacing}`,
      `人物 A 画面位置：${input.shot.characterAPlacement.screenPosition}`,
      `人物 B 绝对位置：${input.shot.characterBPlacement.absoluteLocation}`,
      `人物 B 定位锚点：${input.shot.characterBPlacement.anchorObject}`,
      `人物 B 相对锚点：${input.shot.characterBPlacement.relationToAnchor}`,
      `人物 B 距离和尺度：${input.shot.characterBPlacement.distanceScale}`,
      `人物 B 朝向：${input.shot.characterBPlacement.bodyFacing}`,
      `人物 B 画面位置：${input.shot.characterBPlacement.screenPosition}`,
      `两人关系：${input.shot.relationshipBetweenCharacters}`,
      `前景：${input.shot.foregroundLayer}`,
      `中景：${input.shot.midgroundLayer}`,
      `背景：${input.shot.backgroundLayer}`,
      `摄影机视角：${input.shot.cameraView}`,
      '禁止项：',
      negativeList,
      '最终图必须同时出现人物 A 和人物 B，不能合并两个人，不能互换身份，不能只出现一个人。',
      '最终图不得出现文字、字幕、坐标、网格、箭头、摄影机图标、水印或调度说明。',
    ].join('\n')
  }

  return [
    `Use reference image 1 as the scene asset, reference image 2 as character A, and reference image 3 as character B. Generate shot ${input.shot.shotNumber} in the sequential cinematic image set.`,
    'Core task: strictly place both character A and character B according to the text-based absolute placement descriptions. Do not use coordinates and do not output a placement guide.',
    `Current shot: shot ${input.shot.shotNumber}, ${input.shot.shotLabel}`,
    `Story: ${input.storyPrompt}`,
    `Character A absolute location: ${input.shot.characterAPlacement.absoluteLocation}`,
    `Character A placement anchor: ${input.shot.characterAPlacement.anchorObject}`,
    `Character A relation to anchor: ${input.shot.characterAPlacement.relationToAnchor}`,
    `Character A distance and scale: ${input.shot.characterAPlacement.distanceScale}`,
    `Character A facing: ${input.shot.characterAPlacement.bodyFacing}`,
    `Character A screen position: ${input.shot.characterAPlacement.screenPosition}`,
    `Character B absolute location: ${input.shot.characterBPlacement.absoluteLocation}`,
    `Character B placement anchor: ${input.shot.characterBPlacement.anchorObject}`,
    `Character B relation to anchor: ${input.shot.characterBPlacement.relationToAnchor}`,
    `Character B distance and scale: ${input.shot.characterBPlacement.distanceScale}`,
    `Character B facing: ${input.shot.characterBPlacement.bodyFacing}`,
    `Character B screen position: ${input.shot.characterBPlacement.screenPosition}`,
    `Relationship between characters: ${input.shot.relationshipBetweenCharacters}`,
    `Foreground: ${input.shot.foregroundLayer}`,
    `Midground: ${input.shot.midgroundLayer}`,
    `Background: ${input.shot.backgroundLayer}`,
    `Camera view: ${input.shot.cameraView}`,
    'Forbidden errors:',
    negativeList,
    'The final image must contain both character A and character B. Do not merge the two characters, swap their identities, or show only one character.',
    'Do not include text, subtitles, coordinates, grids, arrows, camera icons, watermarks, or blocking notes in the final image.',
  ].join('\n')
}
