import type {
  GoldenChatCompletionRequest,
  GoldenModelDecision,
} from './protocol'
import {
  buildGoldenScriptIntakePlan,
  generateGoldenResponseFormatText,
  generateGoldenStructuredValue,
} from './structured-value'

const WRITE_TOOL_PRIORITY = [
  'request_script_intake_choice',
  'ingest_script',
  'request_edit_script_review_choice',
  'approve_script',
  'generate_bible_from_script',
  'request_edit_bible_review_choice',
  'confirm_bible',
  'generate_edit_style_previews',
  'generate_edit_style_preview_images',
  'request_edit_style_choice',
  'confirm_edit_style_preview',
  'plan_chapters',
  'generate_edit_script',
  'generate_edit_script_assets',
  'request_edit_asset_review_choice',
  'approve_edit_script_assets',
  'generate_edit_shot_execution_plan',
  'generate_edit_script_storyboard_images',
  'generate_episode_videos',
  'render_chapters',
  'plan_episode_bgm_score',
  'generate_episode_bgm_score',
  'plan_episode_soundscape',
  'generate_episode_soundscape',
  'render_final_video',
] as const

const WORKFLOW_POSITION_CHOICE_TOOL: Readonly<Record<string, string>> = {
  'script_intake:ready': 'request_script_intake_choice',
  'source_script:needs_user_choice': 'request_edit_script_review_choice',
  'episode_plan:needs_user_choice': 'request_edit_bible_review_choice',
  'visual_style:needs_user_choice': 'request_edit_style_choice',
  'planned_assets:needs_user_choice': 'request_edit_asset_review_choice',
}

const TOOL_ARGUMENT_OVERRIDES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  request_script_intake_choice: { seedText: '恐怖故事' },
  ingest_script: {
    sourceKind: 'prompt_generated_outline',
    text: 'A deterministic folk-horror story about a lost traveler, a forbidden shrine, and a closed-loop ending.',
  },
  request_edit_script_review_choice: {},
  approve_script: {},
  generate_bible_from_script: {},
  request_edit_bible_review_choice: {},
  confirm_bible: { aspectRatio: '16:9' },
  generate_edit_style_previews: { styleDirection: null },
  generate_edit_style_preview_images: {},
  request_edit_style_choice: {},
  confirm_edit_style_preview: {},
  plan_chapters: { chapterIds: null },
  generate_edit_script: { chapterId: null },
  generate_edit_script_assets: { chapterId: null },
  request_edit_asset_review_choice: {},
  approve_edit_script_assets: {},
  generate_edit_shot_execution_plan: { chapterId: null },
  generate_edit_script_storyboard_images: {},
  generate_episode_videos: { chapterId: null },
  render_chapters: { chapterId: null },
  plan_episode_bgm_score: {},
  generate_episode_bgm_score: {},
  plan_episode_soundscape: {},
  generate_episode_soundscape: {},
  render_final_video: {},
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readJsonObjectAfterMarker(prompt: string, markers: readonly string[]): Record<string, unknown> | null {
  const marker = markers.find((candidate) => prompt.includes(candidate))
  if (!marker) return null
  const objectStart = prompt.indexOf('{', prompt.indexOf(marker) + marker.length)
  if (objectStart < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = objectStart; index < prompt.length; index += 1) {
    const character = prompt[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return asRecord(JSON.parse(prompt.slice(objectStart, index + 1)))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function buildToolArguments(request: GoldenChatCompletionRequest, toolName: string): unknown {
  const tool = request.tools?.find((candidate) => candidate.function.name === toolName)
  const parameters = asRecord(tool?.function.parameters)
  const generated = asRecord(generateGoldenStructuredValue(parameters)) ?? {}
  const properties = asRecord(parameters?.properties) ?? {}
  const overrides = TOOL_ARGUMENT_OVERRIDES[toolName] ?? {}
  for (const [key, value] of Object.entries(overrides)) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) generated[key] = value
  }
  return generated
}

function availableToolNames(request: GoldenChatCompletionRequest): Set<string> {
  return new Set(request.tools?.map((tool) => tool.function.name) ?? [])
}

function hasCompletedToolCall(request: GoldenChatCompletionRequest, toolName: string): boolean {
  const toolNameByCallId = new Map<string, string>()
  for (const message of request.messages) {
    if (!Array.isArray(message.tool_calls)) continue
    for (const toolCall of message.tool_calls) {
      const record = asRecord(toolCall)
      const fn = asRecord(record?.function)
      if (typeof record?.id !== 'string' || typeof fn?.name !== 'string') continue
      toolNameByCallId.set(record.id, fn.name)
    }
  }
  return request.messages.some((message) => (
    message.role === 'tool'
    && typeof message.tool_call_id === 'string'
    && toolNameByCallId.get(message.tool_call_id) === toolName
  ))
}

function messageText(request: GoldenChatCompletionRequest): string {
  return request.messages.flatMap((message) => {
    if (typeof message.content === 'string') return [message.content]
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap((part) => {
      if (typeof part === 'string') return [part]
      if (!part || typeof part !== 'object' || Array.isArray(part)) return []
      const text = (part as Record<string, unknown>).text
      return typeof text === 'string' ? [text] : []
    })
  }).join('\n')
}

interface GoldenPromptSourceBlock {
  readonly blockId: string
  readonly text: string
}

function readPromptSourceBlocks(prompt: string): readonly GoldenPromptSourceBlock[] {
  return [...prompt.matchAll(/\[(p\d{4})\]\n([\s\S]*?)(?=\n\n\[p\d{4}\]\n|\n\n(?:原文长度|Source length)|$)/g)]
    .map((match) => ({
      blockId: match[1] ?? '',
      text: (match[2] ?? '').trim(),
    }))
    .filter((block) => block.blockId && block.text)
}

function uniqueEdgeQuote(text: string, edge: 'start' | 'end'): string {
  const maximum = Math.min(30, text.length)
  for (let length = Math.min(8, maximum); length <= maximum; length += 1) {
    const candidate = edge === 'start' ? text.slice(0, length) : text.slice(-length)
    if (text.indexOf(candidate) === text.lastIndexOf(candidate)) return candidate
  }
  return text
}

function buildPromptSourceAnchor(prompt: string): {
  readonly startBlockId: string
  readonly startQuote: string
  readonly endBlockId: string
  readonly endQuote: string
} | null {
  const blocks = readPromptSourceBlocks(prompt)
  const first = blocks[0]
  const last = blocks.at(-1)
  if (!first || !last) return null
  return {
    startBlockId: first.blockId,
    startQuote: uniqueEdgeQuote(first.text, 'start'),
    endBlockId: last.blockId,
    endQuote: uniqueEdgeQuote(last.text, 'end'),
  }
}

function buildPromptSourceAnchors(prompt: string): readonly {
  readonly startBlockId: string
  readonly startQuote: string
  readonly endBlockId: string
  readonly endQuote: string
}[] {
  return readPromptSourceBlocks(prompt).map((block) => ({
    startBlockId: block.blockId,
    startQuote: uniqueEdgeQuote(block.text, 'start'),
    endBlockId: block.blockId,
    endQuote: uniqueEdgeQuote(block.text, 'end'),
  }))
}

function generateEditBiblePromptContract(prompt: string): string | null {
  const sourceAnchor = buildPromptSourceAnchor(prompt)
  const sourceAnchors = buildPromptSourceAnchors(prompt)
  if (prompt.includes('"voiceProfile"') && prompt.includes('"worldRules"')) {
    return JSON.stringify({
      title: '禁坛归途',
      logline: '迷路旅人被禁忌祭坛困在无法逃离的循环中。',
      synopsis: '旅人在暮色荒野误入废弃祭坛，逃离后却一次次回到原点，并发现循环仍在继续。',
      characters: [{
        entityId: 'character_traveler',
        name: '旅人',
        aliases: [],
        summary: '误入祭坛并试图逃离循环的主角。',
        voiceProfile: '低厚粗粝的成年男声',
      }],
      locations: [{
        entityId: 'location_forbidden_shrine',
        name: '废弃祭坛',
        aliases: ['祭坛'],
        summary: '将旅人困在循环中的荒野祭坛。',
      }],
      worldRules: ['旅人无论如何逃离都会回到祭坛。'],
      styleGuide: {
        visualTone: '暮色笼罩的民俗恐怖',
        cameraLanguage: '以受困者视角逐步揭示重复空间',
        editingLanguage: '重复动作与地点形成闭环节奏',
        colorAndLighting: '低饱和暮色与祭坛微光对比',
      },
    })
  }
  if (!sourceAnchor) return null
  if (prompt.includes('"estimatedDurationSec"') && prompt.includes('"beatId"')) {
    const beatAnchors = sourceAnchors.slice(0, 2)
    return JSON.stringify({
      beats: beatAnchors.map((anchor, index) => ({
        beatId: `beat_${String(index + 1).padStart(3, '0')}`,
        title: index === 0 ? '祭坛循环' : '镜像逼近',
        summary: index === 0
          ? '旅人试图逃离祭坛，却发现自己再次回到原点。'
          : '旅人遇见另一个循环中的自己，并被迫直面祭坛规则。',
        sourceAnchor: anchor,
        estimatedDurationSec: beatAnchors.length > 1 ? 70 : 45,
      })),
    })
  }
  if (prompt.includes('"persistentFacts"') && prompt.includes('"eventId"')) {
    const eventCount = Math.max(1, Math.min(sourceAnchors.length, 2))
    return JSON.stringify({
      events: Array.from({ length: eventCount }, (_, index) => ({
        eventId: `event_${String(index + 1).padStart(3, '0')}`,
        beatId: `beat_${String(index + 1).padStart(3, '0')}`,
        kind: 'rule',
        summary: index === 0 ? '旅人无法离开祭坛所在的循环。' : '循环中的另一个旅人会逐次逼近。',
        entities: [
          { entityType: 'character', entityName: '旅人' },
          { entityType: 'location', entityName: '祭坛' },
        ],
        persistentFacts: [index === 0 ? '旅人逃离后仍会回到祭坛。' : '另一个旅人每次循环都会更靠近祭坛。'],
      })),
    })
  }
  if (prompt.includes('"musicPolicy"') && prompt.includes('"cueId"')) {
    const cueAnchors = sourceAnchors.slice(0, 2)
    return JSON.stringify({
      cues: cueAnchors.map((anchor, index) => ({
        cueId: `cue_${String(index + 1).padStart(3, '0')}`,
        mood: index === 0 ? '危险逼近' : '镜像压迫',
        intensity: index === 0 ? 0.7 : 0.9,
        musicPolicy: 'underscore',
        note: index === 0 ? '循环逐步显现并压迫主角。' : '另一个旅人的出现让循环升级。',
        sourceAnchor: anchor,
      })),
    })
  }
  return null
}

function generateStylePreviewPromptContract(prompt: string): string | null {
  if (
    !prompt.includes('"stylePreviews"')
    || !prompt.includes('"gridImagePrompt"')
    || !prompt.includes('"stylePolicy"')
  ) {
    return null
  }
  const buildStyleBible = (medium: string, mood: string) => ({
    rawUserStyle: null,
    styleSummary: `${medium}，${mood}`,
    stylePolicy: {
      directing: {
        pointOfViewPrompt: '以受困旅人的主观视角观察循环空间',
        performancePrompt: '非真人角色以克制肢体动作表现恐惧',
        informationReleasePrompt: '逐步揭示道路与祭坛重复出现的事实',
        rhythmPrompt: '以重复动作建立闭环并在结尾收紧节奏',
      },
      visual: {
        imageFilterPrompt: medium,
        lightingPrompt: '暮色环境光与祭坛微光形成方向明确的反差',
        colorPrompt: '低饱和蓝灰背景配少量暗红警示色',
        texturePrompt: '保留石材、尘土与风蚀表面的可见纹理',
        compositionPrompt: '用重复地标和封闭纵深强调无法逃离的空间',
      },
      camera: {
        movementPrompt: '缓慢推进与短促回望交替',
        lensAndDepthPrompt: '中广角纵深配清晰前中后景层次',
        videoRhythmPrompt: '重复机位逐次缩短停留时间',
      },
      sound: {
        soundFilterPrompt: '干涩、空旷、带轻微远距回响的声音质感',
      },
    },
  })
  return JSON.stringify({
    stylePreviews: [
      {
        styleKey: 'style_a',
        title: '暮色手绘惊悚',
        summary: '以二维手绘质感清晰呈现祭坛循环。',
        styleBible: buildStyleBible('二维手绘动画，硬边阴影与细密线稿', '压抑而清晰'),
        gridImagePrompt: '生成一张 16:9 横版三行三列九宫格，以二维手绘动画表现旅人反复回到暮色祭坛的九个关键画面。',
      },
      {
        styleKey: 'style_b',
        title: '风格化立体寓言',
        summary: '以非真人风格化三维角色和夸张空间强化闭环。',
        styleBible: buildStyleBible('非真人风格化 3D，几何化角色与微缩场景', '诡异而强烈'),
        gridImagePrompt: '生成一张 16:9 横版三行三列九宫格，以非真人风格化 3D 表现旅人被几何化祭坛空间困住的九个关键画面。',
      },
      {
        styleKey: 'style_c',
        title: '剪纸影戏迷局',
        summary: '以层叠剪纸和影戏空间表现无法逃离的民俗禁忌。',
        styleBible: buildStyleBible('多层剪纸拼贴与侧光影戏质感', '克制而神秘'),
        gridImagePrompt: '生成一张 16:9 横版三行三列九宫格，以多层剪纸影戏表现旅人与祭坛循环的九个关键画面。',
      },
    ],
  })
}

function generateEditScriptPromptContract(prompt: string): string | null {
  if (!prompt.includes('"generationSegments"') || !prompt.includes('"shotPurpose"')) return null
  const assetMenu = readJsonObjectAfterMarker(prompt, ['已确认资产菜单：', 'Confirmed asset menu:'])
  const locations = Array.isArray(assetMenu?.locations) ? assetMenu.locations : []
  const characters = Array.isArray(assetMenu?.characters) ? assetMenu.characters : []
  const location = asRecord(locations[0])
  const character = asRecord(characters[0])
  const locationName = typeof location?.name === 'string' ? location.name : null
  const characterName = typeof character?.name === 'string' ? character.name : null
  if (!locationName || !characterName) return null
  const presentCharacter = {
    characterName,
    visibility: 'visible',
    role: 'focus',
    performance: '拖着受伤的脚谨慎靠近祭坛并观察石碑变化',
  }
  return JSON.stringify({
    shots: [
      {
        shotRef: 'shot-001',
        shotNumber: 1,
        shotPurpose: 'establishing',
        durationSec: 4,
        scene: { locationName, subScene: '暮色荒野中的废弃祭坛全貌' },
        action: '暮色笼罩荒野，废弃祭坛立在唯一小路尽头。',
        characters: [],
        keyObjects: [{ name: '祭坛石碑', role: '建立循环发生的固定地标' }],
        dialogue: [],
        sound: '低沉风声与远处空旷回响。',
      },
      {
        shotRef: 'shot-002',
        shotNumber: 2,
        shotPurpose: 'action',
        durationSec: 4,
        scene: { locationName, subScene: '祭坛前的石碑旁' },
        action: '旅人拖着受伤的脚靠近石碑，死字突然闪烁成数字四。',
        characters: [presentCharacter],
        keyObjects: [{ name: '石碑上的数字四', role: '揭示祭坛异常规则' }],
        dialogue: [],
        sound: '脚步摩擦地面，石碑发出短促异响。',
      },
      {
        shotRef: 'shot-003',
        shotNumber: 3,
        shotPurpose: 'action',
        durationSec: 4,
        scene: { locationName, subScene: '祭坛与唯一小路交界处' },
        action: '旅人沿小路狂奔后再次回到祭坛，看见脚边仍留着自己的血迹。',
        characters: [presentCharacter],
        keyObjects: [{ name: '血迹', role: '证明旅人回到了同一地点' }],
        dialogue: [],
        sound: '奔跑喘息骤停，远处响起相同的喘息声。',
      },
    ],
    generationSegments: [{
      shotRefs: ['shot-001', 'shot-002', 'shot-003'],
      continuity: '三个镜头共享祭坛空间、旅人的连续行动与逐步增强的循环压迫感。',
    }],
  })
}

function generateLocationCandidatePromptContract(prompt: string): string | null {
  const isLocationCandidatePrompt = (
    prompt.includes('location_candidate_prompt')
    || (
      prompt.includes('场景生成要求')
      && prompt.includes('最终可复用场景资产图片提示词')
    )
    || (
      prompt.includes('scene generation requirements')
      && prompt.includes('reusable scene asset image prompt')
    )
  )
  if (!isLocationCandidatePrompt) return null
  return JSON.stringify({
    prompt: '「废弃祭坛」前景是风蚀碎石与留有落位空地的弯曲小路，中景为开裂的青灰石质祭台、倾斜石碑和三根残柱，背景是低矮荒坡与枯树形成的封闭地平线；暮色从左后方压低照度，祭坛缝隙透出微弱暗红光，尘土与石材纹理清晰，完整全景不含人物。',
  })
}

function generateLocationSpatialProfileContract(prompt: string): string | null {
  const isSpatialProfile = (
    (prompt.includes('分析场景图片的空间结构') && prompt.includes('"sceneSummary"'))
    || (prompt.includes('spatial structure of a location image') && prompt.includes('"sceneSummary"'))
  )
  if (!isSpatialProfile) return null
  return JSON.stringify({
    sceneSummary: '弯曲小路从碎石前景通向画面中央的废弃石质祭坛，残柱与枯树围合出封闭的荒野空间。',
    anchors: [
      {
        id: 'anchor_shrine',
        label: '中央石质祭坛',
        screenArea: '画面中央偏后',
        depthLayer: '中景',
        spatialRelations: ['弯曲小路止于祭坛前方', '三根残柱分布在祭坛两侧'],
      },
      {
        id: 'anchor_stela',
        label: '倾斜石碑',
        screenArea: '祭坛中央',
        depthLayer: '中景',
        spatialRelations: ['石碑立在祭台后缘', '石碑后方是低矮荒坡'],
      },
    ],
    depthLayout: {
      foreground: '风蚀碎石和留有空地的弯曲小路占据前景。',
      midground: '青灰石质祭台、倾斜石碑与残柱构成中景主体。',
      background: '低矮荒坡、枯树和封闭地平线位于背景。',
    },
    lightingDirection: '暮色从画面左后方照入，祭坛缝隙有微弱暗红光。',
  })
}

function generateShotExecutionPlanContract(prompt: string): string | null {
  if (!prompt.includes('"generationSegmentExecutions"') || !prompt.includes('"continuousVideoPrompt"')) return null
  const corePlan = readJsonObjectAfterMarker(prompt, ['核心剪辑计划：', 'Core Edit Plan:'])
  const coreShots = Array.isArray(corePlan?.shots) ? corePlan.shots : []
  const coreSegments = Array.isArray(corePlan?.videoGenerationSegments)
    ? corePlan.videoGenerationSegments
    : Array.isArray(corePlan?.generationSegments)
      ? corePlan.generationSegments
      : []
  if (coreShots.length === 0 || coreSegments.length === 0) return null
  const shots = coreShots.flatMap((value) => {
    const shot = asRecord(value)
    if (typeof shot?.shotRef !== 'string' || typeof shot.shotNumber !== 'number') return []
    const characters = Array.isArray(shot.characters) ? shot.characters : []
    const keyObjects = Array.isArray(shot.keyObjects) ? shot.keyObjects : []
    const scene = asRecord(shot.scene)
    const blockingCharacters = characters.flatMap((characterValue) => {
      const character = asRecord(characterValue)
      if (typeof character?.characterName !== 'string') return []
      const visibility = typeof character.visibility === 'string' ? character.visibility : 'visible'
      return [{
        characterName: character.characterName,
        visibility,
        position: '祭坛前方的弯曲小路附近',
        screenPosition: '画面中部',
        facing: '朝向祭坛石碑',
        eyeline: '视线落在石碑与前方道路之间',
      }]
    })
    const blockingObjects = keyObjects.flatMap((objectValue) => {
      const object = asRecord(objectValue)
      if (typeof object?.name !== 'string') return []
      return [{
        name: object.name,
        position: '祭坛主体空间内的稳定位置',
        screenPosition: '画面视觉中心附近',
      }]
    })
    const subjects = [
      ...blockingCharacters.map((character) => character.characterName),
      ...blockingObjects.map((object) => object.name),
    ]
    const action = typeof shot.action === 'string' ? shot.action : '保持核心剪辑计划中的镜头动作。'
    return [{
      shotRef: shot.shotRef,
      camera: {
        shotScale: shot.shotNumber === 1 ? '大全景' : '中景',
        lens: '28mm 中广角',
        focus: '主体清晰，保留前中后景层次',
        height: '平视高度',
        angle: '轻微低角度',
        movement: shot.shotNumber === 1 ? '缓慢推进建立空间' : '跟随主体动作短促移动',
        composition: '小路形成纵深引导线，祭坛与石碑保持为视觉中心',
        lighting: '暮色从左后方照入，祭坛缝隙的暗红光勾勒主体边缘',
      },
      blocking: {
        axis: {
          type: '祭坛与小路之间的行动轴线',
          subjects: subjects.length > 0
            ? subjects
            : [typeof scene?.locationName === 'string' ? scene.locationName : '祭坛空间'],
          screenDirection: '主体沿小路向画面中央祭坛移动，左右关系保持稳定',
        },
        characters: blockingCharacters,
        objects: blockingObjects,
        spatialNote: '保持弯曲小路、中央祭坛、石碑和背景荒坡的前中后景关系。',
      },
      videoPrompt: `${action} 镜头运动与动作同步，使用短促脚步或物体触碰声，不增加对白或连续氛围底噪。`,
    }]
  })
  const shotByRef = new Map(shots.map((shot) => [shot.shotRef, shot]))
  const generationSegmentExecutions = coreSegments.flatMap((value) => {
    const segment = asRecord(value)
    const shotRefs = Array.isArray(segment?.shotRefs)
      ? segment.shotRefs.filter((shotRef): shotRef is string => typeof shotRef === 'string')
      : []
    const segmentRef = typeof segment?.segmentRef === 'string' ? segment.segmentRef : null
    if (!segmentRef || shotRefs.length === 0 || shotRefs.some((shotRef) => !shotByRef.has(shotRef))) return []
    let elapsed = 0
    const timedSections = shotRefs.map((shotRef, index) => {
      const sourceShot = asRecord(coreShots.find((candidate) => asRecord(candidate)?.shotRef === shotRef))
      const duration = typeof sourceShot?.durationSec === 'number' ? sourceShot.durationSec : 3
      const start = elapsed
      elapsed += duration
      const execution = shotByRef.get(shotRef)
      return `[00:${String(start).padStart(2, '0')}-00:${String(elapsed).padStart(2, '0')}] 镜头${String(index + 1)}：${execution?.videoPrompt ?? ''}`
    })
    return [{
      segmentRef,
      continuousVideoPrompt: `16:9 二维手绘连续片段，低饱和蓝灰与暗红微光，镜头节奏逐步收紧。${timedSections.join(' ')}`,
    }]
  })
  if (shots.length !== coreShots.length || generationSegmentExecutions.length !== coreSegments.length) return null
  return JSON.stringify({ shots, generationSegmentExecutions })
}

function generateBgmScorePlanContract(prompt: string): string | null {
  if (
    !prompt.includes('"creativeBrief"')
    || !prompt.includes('"scoreDesign"')
    || !prompt.includes('"virtualLayers"')
    || !prompt.includes('"finalPrompt"')
  ) return null
  const requiredShape = readJsonObjectAfterMarker(prompt, ['Required JSON shape:'])
  const durationSeconds = typeof requiredShape?.durationSeconds === 'number'
    ? requiredShape.durationSeconds
    : 12
  return JSON.stringify({
    durationSeconds,
    creativeBrief: {
      cueType: '连续纯器乐背景配乐',
      genre: '民俗恐怖悬疑',
      mood: '从空旷不安逐步收紧到循环揭示',
      narrativeFunction: '用单一低频动机连接祭坛建立、逃离失败与回到原点的剪辑连续性。',
    },
    scoreDesign: {
      overview: '以克制的低音弦乐脉冲和稀疏打击构成一条连续配乐，为原生对白和环境声保留中高频空间。',
      sections: [{
        category: '情绪弧线',
        title: '循环逐步闭合',
        purpose: '让观众在结尾意识到主角重新回到同一地点。',
        startSec: 0,
        endSec: durationSeconds,
        content: '开头保持空旷，中央加入低频脉冲，结尾收紧节奏但不做响亮终止。',
      }],
    },
    virtualLayers: [{
      name: '低频循环动机',
      purpose: '维持整段的心理压迫与连续性。',
      content: '使用低音弦乐和柔和脉冲，不覆盖对白频段，不加入拟音或环境声。',
    }],
    promptSections: [{
      title: '完整情绪与编曲',
      purpose: '把连续时长、叙事击点和混音限制压缩进最终生成提示词。',
      startSec: 0,
      endSec: durationSeconds,
      content: '低饱和民俗恐怖纯器乐，从稀疏悬疑逐步收紧，以循环动机完成结尾。',
    }],
    finalPrompt: `生成一条 ${String(durationSeconds)} 秒完整连续的纯器乐民俗恐怖电影背景配乐：以低音弦乐、克制脉冲和稀疏打击建立空旷不安，随逃离失败逐步收紧，结尾以未解决的循环动机回到起点；不要人声、歌词、对白、拟音或环境声，为视频原生声音保留清晰中高频空间。`,
  })
}

function generateSoundscapePlanContract(prompt: string): string | null {
  if (
    !prompt.includes('"environmentFingerprint"')
    || !prompt.includes('"transitionIn"')
    || !prompt.includes('Final rendered media timeline JSON:')
  ) return null
  const timelinePrompt = prompt.slice(prompt.indexOf('Final rendered media timeline JSON:'))
  const clipOrders = [...timelinePrompt.matchAll(/"clipOrder"\s*:\s*(\d+)/g)]
    .map((match) => Number(match[1]))
  const firstClipOrder = clipOrders[0]
  const lastClipOrder = clipOrders.at(-1)
  if (!firstClipOrder || !lastClipOrder) return null
  return JSON.stringify({
    decision: 'soundscape',
    sources: [{
      sourceId: 'source-001',
      environmentFingerprint: 'twilight_forbidden_shrine_dry_wind',
      prompt: 'Seamless loop of dry twilight wind across an abandoned stone shrine, no music, no voices, no dialogue, no footsteps, no impacts.',
      loopDurationSeconds: 12,
      promptInfluence: 0.55,
    }],
    sections: [{
      sourceId: 'source-001',
      fromClipOrder: firstClipOrder,
      toClipOrder: lastClipOrder,
      perspective: 'exterior_near',
      intensity: 'low',
      transitionIn: 'fade',
      transitionOut: 'crossfade',
    }],
  })
}

function generatePromptContractText(request: GoldenChatCompletionRequest): string | null {
  const prompt = messageText(request)
  if (
    prompt.includes('扩写前创作问诊')
    && prompt.includes('"questions"')
    && prompt.includes('targetRuntime')
  ) {
    return JSON.stringify(buildGoldenScriptIntakePlan())
  }
  if (
    prompt.includes('把用户的故事创意扩写成完整、连贯、可拍摄的剧本')
    && prompt.includes('"segments"')
    && prompt.includes('"episodeIndex"')
  ) {
    return JSON.stringify({
      title: '禁坛归途',
      summary: '迷路旅人误入禁忌祭坛，逃离后发现自己仍在循环起点。',
      segments: [{
        episodeIndex: 0,
        episodeTitle: '禁坛归途',
        episodeSummary: '旅人触犯荒野祭坛禁忌并陷入无法逃出的循环。',
        actIndex: 0,
        actTitle: '荒野闭环',
        actSummary: '从迷路、触禁到循环真相显现。',
        sceneIndex: 0,
        title: '祭坛前的第四次',
        location: '暮色荒野与废弃祭坛',
        timeOfDay: '黄昏',
        characters: ['旅人'],
        summary: '旅人发现每次远离祭坛都会回到同一块刻着“四”的路牌前。',
        body: '暮色压住荒野。旅人拖着受伤的脚走到一座废弃祭坛前。石碑上的“死”字忽然闪烁成数字“4”。他惊恐后退，转身沿唯一的小路狂奔。风声停下时，他再次站在祭坛前，脚边仍是自己刚才留下的血迹。旅人抬头，石碑上的“4”熄灭，又缓慢亮起。远处传来与他一模一样的喘息声。',
        beats: [{
          beatIndex: 0,
          title: '循环显形',
          summary: '旅人逃离失败，并意识到自己已被祭坛困在同一时刻。',
        }],
      }, {
        episodeIndex: 0,
        episodeTitle: '禁坛归途',
        episodeSummary: '旅人触犯荒野祭坛禁忌并陷入无法逃出的循环。',
        actIndex: 1,
        actTitle: '镜像逼近',
        actSummary: '循环中的另一个旅人出现，迫使主角直面祭坛规则。',
        sceneIndex: 0,
        title: '祭坛后的另一个人',
        location: '暮色荒野与废弃祭坛',
        timeOfDay: '入夜',
        characters: ['旅人'],
        summary: '旅人在下一次循环中看见另一个自己正从祭坛背后走来。',
        body: '夜色吞没小路。旅人这次没有逃跑，而是绕到祭坛背后。石碑上的数字从“4”变成“5”，对面也响起拖着伤脚的脚步声。另一个满身尘土的旅人从黑暗里走出，手里握着同样的路牌碎片。他们同时开口询问对方是谁，祭坛随即震动，远处又亮起第三道相同的身影。旅人终于明白，每次循环都会留下一个更接近祭坛的自己。',
        beats: [{
          beatIndex: 0,
          title: '镜像现身',
          summary: '另一个旅人出现，揭示循环会不断留下新的自己。',
        }],
      }],
    })
  }
  const stylePreviewContract = generateStylePreviewPromptContract(prompt)
  if (stylePreviewContract) return stylePreviewContract
  const editScriptContract = generateEditScriptPromptContract(prompt)
  if (editScriptContract) return editScriptContract
  const locationSpatialProfileContract = generateLocationSpatialProfileContract(prompt)
  if (locationSpatialProfileContract) return locationSpatialProfileContract
  const shotExecutionPlanContract = generateShotExecutionPlanContract(prompt)
  if (shotExecutionPlanContract) return shotExecutionPlanContract
  const bgmScorePlanContract = generateBgmScorePlanContract(prompt)
  if (bgmScorePlanContract) return bgmScorePlanContract
  const soundscapePlanContract = generateSoundscapePlanContract(prompt)
  if (soundscapePlanContract) return soundscapePlanContract
  const locationCandidateContract = generateLocationCandidatePromptContract(prompt)
  if (locationCandidateContract) return locationCandidateContract
  return generateEditBiblePromptContract(prompt)
}

function selectWriteTool(request: GoldenChatCompletionRequest): string | null {
  const available = availableToolNames(request)
  const alreadyCalled = new Set<string>()
  for (const message of request.messages) {
    if (!Array.isArray(message.tool_calls)) continue
    for (const toolCall of message.tool_calls) {
      const record = asRecord(toolCall)
      const fn = asRecord(record?.function)
      if (typeof fn?.name === 'string') alreadyCalled.add(fn.name)
    }
  }
  const workflowPosition = readWorkflowPosition(request)
  const choiceTool = workflowPosition ? WORKFLOW_POSITION_CHOICE_TOOL[workflowPosition] : undefined
  if (choiceTool && available.has(choiceTool) && !alreadyCalled.has(choiceTool)) {
    return choiceTool
  }
  const recommendedOperation = readWorkflowRecommendedOperation(request)
  if (recommendedOperation && available.has(recommendedOperation) && !alreadyCalled.has(recommendedOperation)) {
    return recommendedOperation
  }
  return WRITE_TOOL_PRIORITY.find((toolName) => (
    available.has(toolName) && !alreadyCalled.has(toolName)
  )) ?? null
}

function readWorkflowPosition(request: GoldenChatCompletionRequest): string | null {
  const text = messageText(request)
  const step = text.match(/(?:^|\n)workflowStep=([^\n]+)/)?.[1]?.trim() ?? null
  const status = text.match(/(?:^|\n)workflowStatus=([^\n]+)/)?.[1]?.trim() ?? null
  return step && status ? `${step}:${status}` : null
}

function readWorkflowRecommendedOperation(request: GoldenChatCompletionRequest): string | null {
  const operation = messageText(request).match(/(?:^|\n)workflowRecommendedOperation=([^\n]+)/)?.[1]?.trim() ?? null
  return operation && operation !== 'none' ? operation : null
}

function readWorkflowOperationGroupIds(request: GoldenChatCompletionRequest): readonly string[] {
  const raw = messageText(request).match(/(?:^|\n)workflowOperationGroupIds=([^\n]+)/)?.[1]?.trim() ?? ''
  if (!raw || raw === 'none') return []
  return Array.from(new Set(raw.split(',').map((value) => value.trim()).filter(Boolean)))
}

export function decideGoldenModelResponse(input: {
  readonly scenarioId: string
  readonly request: GoldenChatCompletionRequest
  readonly requestOrdinal: number
}): GoldenModelDecision {
  const structuredText = generateGoldenResponseFormatText(input.request.responseFormat)
    ?? (input.request.tools?.length ? null : generatePromptContractText(input.request))
  if (structuredText) {
    return {
      kind: 'text',
      text: structuredText,
    }
  }

  const groupedToolNames = readWorkflowOperationGroupIds(input.request)
    .filter((toolName) => availableToolNames(input.request).has(toolName))
    .filter((toolName) => !hasCompletedToolCall(input.request, toolName))
  if (groupedToolNames.length > 1) {
    return {
      kind: 'tool_calls',
      calls: groupedToolNames.map((toolName) => ({
        toolCallId: `golden_call_${input.requestOrdinal}_${toolName}`,
        toolName,
        argumentsJson: JSON.stringify(buildToolArguments(input.request, toolName)),
      })),
    }
  }

  const toolName = selectWriteTool(input.request)
  if (!toolName) {
    return {
      kind: 'text',
      text: 'The deterministic test model reached a stable boundary.',
    }
  }
  const argumentsValue = buildToolArguments(input.request, toolName)
  return {
    kind: 'tool_call',
    toolCallId: `golden_call_${input.requestOrdinal}_${toolName}`,
    toolName,
    argumentsJson: JSON.stringify(argumentsValue),
  }
}
