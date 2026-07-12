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
  'request_edit_style_choice',
  'confirm_edit_style_preview',
  'plan_chapters',
  'generate_edit_script_assets',
  'request_edit_asset_review_choice',
  'approve_edit_script_assets',
  'generate_edit_shot_execution_plan',
  'generate_edit_script_storyboard',
  'generate_edit_script_storyboard_images',
  'generate_episode_videos',
  'render_chapters',
  'generate_episode_bgm_score',
  'plan_episode_soundscape',
  'generate_episode_soundscape',
  'render_final_video',
] as const

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
  generate_edit_style_previews: {},
  request_edit_style_choice: {},
  confirm_edit_style_preview: {},
  plan_chapters: {},
  generate_edit_script_assets: {},
  request_edit_asset_review_choice: {},
  approve_edit_script_assets: {},
  generate_edit_shot_execution_plan: {},
  generate_edit_script_storyboard: {},
  generate_edit_script_storyboard_images: {},
  generate_episode_videos: {},
  render_chapters: {},
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

function toolOutputCount(request: GoldenChatCompletionRequest): number {
  return request.messages.filter((message) => message.role === 'tool').length
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

function firstAssetId(prompt: string, collection: 'locations' | 'characters'): string | null {
  const assetMenuStart = Math.max(prompt.lastIndexOf('已确认资产菜单：'), prompt.lastIndexOf('Confirmed asset menu:'))
  const scopedPrompt = assetMenuStart >= 0 ? prompt.slice(assetMenuStart) : prompt
  const collectionStart = scopedPrompt.search(new RegExp(`"${collection}"\\s*:\\s*\\[`))
  if (collectionStart < 0) return null
  const match = scopedPrompt.slice(collectionStart).match(/"id"\s*:\s*"([^"]+)"/)
  return match?.[1] ?? null
}

function firstShotId(prompt: string): string | null {
  const planStart = Math.max(prompt.lastIndexOf('核心剪辑计划：'), prompt.lastIndexOf('Core edit plan:'))
  const scopedPrompt = planStart >= 0 ? prompt.slice(planStart) : prompt
  return scopedPrompt.match(/"shotId"\s*:\s*"([^"]+)"/)?.[1] ?? null
}

function shotIds(prompt: string): string[] {
  const planStart = Math.max(prompt.lastIndexOf('核心剪辑计划：'), prompt.lastIndexOf('Core edit plan:'))
  const scopedPrompt = planStart >= 0 ? prompt.slice(planStart) : prompt
  const singular = Array.from(scopedPrompt.matchAll(/"shotId"\s*:\s*"([^"]+)"/g), (match) => match[1])
  const grouped = Array.from(scopedPrompt.matchAll(/"shotIds"\s*:\s*\[([\s\S]*?)\]/g))
    .flatMap((match) => Array.from(match[1].matchAll(/"([^"]+)"/g), (item) => item[1]))
  return [...singular, ...grouped].filter((shotId, index, all) => all.indexOf(shotId) === index)
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
      version: 1,
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
      }],
    })
  }
  if (
    prompt.includes('整理出这一集稳定成立的事实')
    && prompt.includes('"worldRules"')
    && prompt.includes('"styleGuide"')
  ) {
    return JSON.stringify({
      title: '禁坛归途',
      logline: '迷路旅人触犯荒野祭坛禁忌，被困在无法逃离的循环中。',
      synopsis: '旅人在暮色荒野误入废弃祭坛，发现无论怎样逃离都会回到原点，并听见另一个自己的喘息。',
      characters: [{
        entityId: 'character_traveler',
        name: '旅人',
        aliases: [],
        summary: '误入祭坛并逐渐确认自己陷入时间循环的独行者。',
        voiceProfile: '偏低沉干涩带轻微颗粒感的青年男声',
      }],
      locations: [{
        entityId: 'location_forbidden_shrine',
        name: '废弃祭坛',
        aliases: ['祭坛'],
        summary: '位于暮色荒野、会令旅人不断回到原点的禁忌空间。',
      }],
      worldRules: ['离开祭坛的旅人会再次回到祭坛前。'],
      styleGuide: {
        visualTone: '暮色压迫下的民俗恐怖与循环异象',
        cameraLanguage: '贴近旅人的受限视角与重复空间构图',
        editingLanguage: '逃离动作逐步加速并以重复画面突然收束',
        colorAndLighting: '低饱和冷暮色配合石碑异常亮光',
      },
    })
  }
  if (
    prompt.includes('切分成一个个剧情单元（beat）')
    && prompt.includes('"sourceAnchor"')
  ) {
    return JSON.stringify({
      beats: [{
        beatId: 'beat_001',
        title: '祭坛循环显形',
        summary: '旅人逃离祭坛失败，并确认自己被困在不断重置的荒野中。',
        sourceAnchor: {
          startBlockId: 'p0001',
          startQuote: '暮色压住荒野。',
          endBlockId: 'p0001',
          endQuote: '远处传来与他一模一样的喘息声。',
        },
        estimatedDurationSec: 45,
      }],
    })
  }
  if (
    prompt.includes('所有发生之后会持续影响后文的事件和状态变化')
    && prompt.includes('"persistentFacts"')
  ) {
    return JSON.stringify({
      events: [{
        eventId: 'event_001',
        beatId: 'beat_001',
        kind: 'rule',
        summary: '旅人确认离开祭坛后仍会回到原点。',
        entities: [
          { entityType: 'character', entityName: '旅人' },
          { entityType: 'location', entityName: '废弃祭坛' },
        ],
        persistentFacts: ['旅人被困在祭坛周围的循环中。'],
      }],
    })
  }
  if (
    prompt.includes('划分成一段段情绪相对稳定的区间')
    && prompt.includes('"musicPolicy"')
  ) {
    return JSON.stringify({
      cues: [{
        cueId: 'cue_001',
        mood: '危险逼近',
        intensity: 0.8,
        musicPolicy: 'underscore',
        note: '逃离失败和重复喘息持续抬高压力。',
        sourceAnchor: {
          startBlockId: 'p0001',
          startQuote: '暮色压住荒野。',
          endBlockId: 'p0001',
          endQuote: '远处传来与他一模一样的喘息声。',
        },
      }],
    })
  }
  if (
    prompt.includes('你是影片画面风格方案设计师')
    && prompt.includes('"stylePreviews"')
    && prompt.includes('"gridImagePrompt"')
  ) {
    const buildStyleBible = (styleSummary: string, medium: string) => ({
      rawUserStyle: null,
      styleSummary,
      stylePolicy: {
        directing: {
          pointOfViewPrompt: '始终贴近旅人的受限视角，祭坛只通过局部逐步显露',
          performancePrompt: '旅人的动作从谨慎试探逐步升级为失控逃离',
          informationReleasePrompt: '先呈现重复空间，再揭示血迹和相同喘息',
          rhythmPrompt: '以短暂静止和突然奔跑形成递增压迫',
        },
        visual: {
          imageFilterPrompt: `${medium}，非真人角色，民俗恐怖画面`,
          lightingPrompt: '暮色低照度，石碑异常冷光作为局部视觉锚点',
          colorPrompt: '低饱和青灰荒野配合暗红血迹',
          texturePrompt: '粗粝纸面与风化石材纹理',
          compositionPrompt: '重复使用祭坛居中和小路纵深构图强化闭环',
        },
        camera: {
          movementPrompt: '缓慢逼近与手持式逃离运动交替',
          lensAndDepthPrompt: '中广角近身透视，背景雾化但保留祭坛轮廓',
          videoRhythmPrompt: '稳定观察逐步切换为快速重复段落',
        },
        sound: {
          soundFilterPrompt: '干涩近距离环境质感与空旷回声',
        },
      },
    })
    return JSON.stringify({
      stylePreviews: [
        {
          styleKey: 'style_a',
          title: '剪纸暮野',
          summary: '以层叠剪纸和粗粝纤维表现祭坛循环。',
          styleBible: buildStyleBible('层叠剪纸民俗恐怖，轮廓清晰且空间压迫', '手工剪纸二维动画'),
          gridImagePrompt: '16:9 横版三行三列九宫格，展示旅人抵达祭坛、石碑闪烁、逃离和循环重返，全程剪纸二维动画。',
        },
        {
          styleKey: 'style_b',
          title: '木偶荒原',
          summary: '以风格化木偶和微缩场景强化不自然的重复感。',
          styleBible: buildStyleBible('风格化木偶与微缩荒野，材质阴冷且动作克制', '风格化木偶定格动画'),
          gridImagePrompt: '16:9 横版三行三列九宫格，展示同一剧情关键段落，全程风格化木偶定格动画。',
        },
        {
          styleKey: 'style_c',
          title: '墨影闭环',
          summary: '以水墨晕染和留白构成更克制的循环异象。',
          styleBible: buildStyleBible('水墨晕染与大面积留白，异常符号以冷光出现', '手绘水墨二维动画'),
          gridImagePrompt: '16:9 横版三行三列九宫格，展示祭坛循环的九个关键画面，全程手绘水墨二维动画。',
        },
      ],
    })
  }
  if (
    prompt.includes('你是这部短片的剪辑规划师')
    && prompt.includes('"generationSegments"')
    && prompt.includes('"persistentFactsIntroduced"')
  ) {
    const locationId = firstAssetId(prompt, 'locations')
    if (!locationId) throw new Error('GOLDEN_EDIT_SCRIPT_LOCATION_ID_MISSING')
    return JSON.stringify({
      shots: [{
        shotId: 'shot-001',
        shotNumber: 1,
        shotPurpose: 'establishing',
        durationSec: 3,
        scene: {
          locationId,
          subScene: '祭坛与荒野小路交界处',
        },
        action: '暮色笼罩废弃祭坛，旅人留下的血迹沿小路延伸后又回到原点。',
        characters: [],
        keyObjects: [{ name: '石碑', role: '标记循环重新开始的视觉锚点' }],
        dialogue: [],
        sound: '干燥风声与远处重复的喘息逐渐靠近。',
      }, {
        shotId: 'shot-002',
        shotNumber: 2,
        shotPurpose: 'action',
        durationSec: 3,
        scene: {
          locationId,
          subScene: '祭坛前与重复出现的小路',
        },
        action: '旅人沿小路逃离，却再次从同一方向冲回祭坛前。',
        characters: [],
        keyObjects: [{ name: '石碑', role: '确认空间循环的固定标记' }],
        dialogue: [],
        sound: '奔跑脚步与重复的喘息在祭坛前重叠。',
      }],
      generationSegments: [{
        shotIds: ['shot-001', 'shot-002'],
        continuity: '同一祭坛空间和持续逼近的声音保持连续。',
      }],
      persistentFactsIntroduced: [],
    })
  }
  if (
    prompt.includes('场景生成要求')
    && prompt.includes('生成1条中文环境描述')
    && prompt.includes('"prompt"')
  ) {
    return JSON.stringify({
      prompt: '「废弃祭坛」4:3横版全景，前景是带血迹的碎石小路与枯草，中景为风化石碑和留有空位的环形祭台，背景是低矮荒丘与灰蓝暮雾；冷光从石碑缝隙透出，青灰剪纸纤维与粗粝石材层次清晰，无人物、文字、水印或标志。',
    })
  }
  if (
    prompt.includes('分析场景图片的空间结构')
    && prompt.includes('"schemaVersion"')
    && prompt.includes('"anchors"')
  ) {
    return JSON.stringify({
      schemaVersion: 1,
      sceneSummary: '碎石小路从前景通向居中的环形祭台，风化石碑立于中景，荒丘与暮雾构成远处边界。',
      anchors: [{
        id: 'anchor_shrine_stele',
        label: '祭台石碑',
        screenArea: '画面中央',
        depthLayer: '中景',
        spatialRelations: ['碎石小路止于石碑前方', '环形祭台围绕石碑展开'],
      }],
      depthLayout: {
        foreground: '带血迹的碎石小路与两侧枯草形成进入空间。',
        midground: '环形祭台和风化石碑占据画面中央。',
        background: '低矮荒丘与灰蓝暮雾封住远景。',
      },
      lightingDirection: '石碑缝隙的冷光向前方和两侧扩散。',
    })
  }
  if (
    prompt.includes('摄影执行设计师')
    && prompt.includes('"generationSegmentExecutions"')
    && prompt.includes('"continuousVideoPrompt"')
  ) {
    const plannedShotIds = shotIds(prompt)
    const shotId = plannedShotIds[0] ?? firstShotId(prompt)
    if (!shotId) throw new Error('GOLDEN_SHOT_EXECUTION_SHOT_ID_MISSING')
    const secondShotId = plannedShotIds[1] ?? shotId
    return JSON.stringify({
      shots: [{
        shotId,
        shotNumber: 1,
        camera: {
          shotScale: '全景',
          lens: '24毫米广角',
          focus: '祭台石碑清晰，前后景保持可辨',
          height: '平视高度',
          angle: '正面略低角度',
          movement: '固定机位缓慢推近石碑',
          composition: '碎石路由前景指向中央石碑，荒丘封住背景',
          lighting: '石碑缝隙冷光照亮祭台边缘，暮色压暗远景',
        },
        blocking: {
          axis: {
            type: '小路与石碑中心轴',
            subjects: ['石碑'],
            screenDirection: '石碑保持画面中央，小路由下方向中央延伸',
          },
          characters: [],
          objects: [{
            name: '石碑',
            position: '环形祭台中央',
            screenPosition: '画面中央中景',
          }],
          spatialNote: '保持碎石路、环形祭台和石碑的前中景纵深关系。',
        },
        videoPrompt: '16:9剪纸民俗恐怖全景，镜头沿碎石路缓慢推向祭台中央石碑，冷光在石缝间轻微闪烁，枯草短促摆动，不出现人物或对白。',
      }, {
        shotId: secondShotId,
        shotNumber: 2,
        camera: {
          shotScale: '中景',
          lens: '35毫米镜头',
          focus: '小路出口与石碑同时可辨',
          height: '胸口高度',
          angle: '侧前方角度',
          movement: '沿小路快速后拉并在祭坛前停住',
          composition: '小路出口与中央石碑形成循环构图',
          lighting: '石碑冷光在奔跑路径上短暂扫过',
        },
        blocking: {
          axis: {
            type: '小路循环轴线',
            subjects: ['石碑'],
            screenDirection: '运动方向最终回到画面中央',
          },
          characters: [],
          objects: [{ name: '石碑', position: '环形祭台中央', screenPosition: '画面中央中景' }],
          spatialNote: '保持小路绕回祭坛的连续空间关系。',
        },
        videoPrompt: '16:9剪纸民俗恐怖中景，镜头沿小路快速后拉，最终回到祭台中央的石碑。',
      }],
      generationSegmentExecutions: [{
        shotIds: [shotId, secondShotId],
        continuousVideoPrompt: '16:9剪纸民俗恐怖连续片段，冷青灰暮色。[00:00-00:03] 全景镜头沿碎石路缓慢推向石碑。[00:03-00:06] 镜头快速后拉经过小路，却再次回到同一祭坛前。',
      }],
    })
  }
  if (
    prompt.includes('你是专业影视作曲师')
    && prompt.includes('"scoreDesign"')
    && prompt.includes('"finalPrompt"')
  ) {
    const durationSeconds = Number(prompt.match(/"durationSeconds"\s*:\s*([0-9.]+)/)?.[1] ?? 6)
    return JSON.stringify({
      durationSeconds,
      creativeBrief: {
        cueType: '连续纯器乐背景配乐',
        genre: '民俗恐怖电影配乐',
        mood: '克制、阴冷并逐步逼近',
        narrativeFunction: '用反复动机连接祭坛显现与逃离失败。',
      },
      scoreDesign: {
        overview: '低频持续音与短促木质脉冲构成闭环，结尾不完全解决。',
        sections: [{
          category: '情绪弧线',
          title: '祭坛循环',
          purpose: '维持压迫并为原生声音留出空间。',
          startSec: 0,
          endSec: durationSeconds,
          content: '从几乎静止的低音开始，在中段加入一次短促击点，最后回到未解决的持续音。',
        }],
      },
      virtualLayers: [{
        name: '低频阴影',
        purpose: '维持空间压迫',
        content: '低音区缓慢起伏，避免覆盖对白和环境声。',
      }],
      promptSections: [{
        title: '连续主提示',
        purpose: '定义整段配乐的弧线',
        startSec: 0,
        endSec: durationSeconds,
        content: '低饱和民俗恐怖纯器乐，稀疏木质脉冲与低频持续音，为原生声音留白。',
      }],
      finalPrompt: `生成一条 ${durationSeconds} 秒完整连续的纯器乐民俗恐怖电影背景配乐。以低饱和低频持续音为基础，加入稀疏的木质脉冲和轻微失谐，中段短暂提升张力，结尾回到未解决的循环动机。保持克制的动态和中低频空间，为视频原生环境声留出清晰位置；不要人声、歌词、对白、拟音或独立音效。`,
    })
  }
  if (
    prompt.includes('你是专业影视声音设计师')
    && prompt.includes('"environmentFingerprint"')
    && prompt.includes('"fromShotId"')
  ) {
    const timelineShotIds = shotIds(prompt)
    const fromShotId = timelineShotIds[0] ?? 'shot-001'
    const toShotId = timelineShotIds.at(-1) ?? fromShotId
    return JSON.stringify({
      schemaVersion: 1,
      decision: 'soundscape',
      sources: [{
        sourceId: 'shrine-wind',
        environmentFingerprint: 'exterior-forbidden-shrine-dry-wind',
        prompt: 'Seamless loop of sparse dry wind across an abandoned stone shrine, no music, no voices, no dialogue, no footsteps, no impacts.',
        loopDurationSeconds: 6,
        promptInfluence: 0.8,
      }],
      sections: [{
        sourceId: 'shrine-wind',
        fromShotId,
        toShotId,
        perspective: 'exterior_near',
        intensity: 'low',
        transitionIn: 'cut',
        transitionOut: 'cut',
      }],
    })
  }
  return null
}

function selectWriteTool(request: GoldenChatCompletionRequest, forcedToolName?: string | null): string | null {
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
  // An approved operation resumes in a new execution segment. Its earlier tool
  // call only created the Approval and must not suppress the granted execution.
  if (forcedToolName && available.has(forcedToolName)) {
    return forcedToolName
  }
  const availableChoiceTool = [...available].find((toolName) => (
    toolName.startsWith('request_')
    && toolName.endsWith('_choice')
    && !alreadyCalled.has(toolName)
  ))
  if (availableChoiceTool) return availableChoiceTool
  return WRITE_TOOL_PRIORITY.find((toolName) => (
    available.has(toolName) && !alreadyCalled.has(toolName)
  )) ?? null
}

export function decideGoldenModelResponse(input: {
  readonly scenarioId: string
  readonly request: GoldenChatCompletionRequest
  readonly requestOrdinal: number
  readonly forcedToolName?: string | null
}): GoldenModelDecision {
  if (input.scenarioId === 'disconnect-mid-tool-call') return { kind: 'disconnect' }

  const structuredText = generateGoldenResponseFormatText(input.request.responseFormat)
    ?? generatePromptContractText(input.request)
  if (structuredText) {
    return {
      kind: 'text',
      text: structuredText,
    }
  }

  const toolName = selectWriteTool(input.request, input.forcedToolName)
  if (
    input.scenarioId === 'stop-after-successful-confirmation'
    && toolOutputCount(input.request) > 0
  ) {
    return {
      kind: 'text',
      text: 'Confirmation succeeded. I am stopping without requesting the next operation.',
    }
  }
  if (!toolName) {
    return {
      kind: 'text',
      text: 'The deterministic test model reached a stable boundary.',
    }
  }
  const argumentsValue = buildToolArguments(input.request, toolName)
  if (input.scenarioId === 'duplicate-tool-call') {
    const argumentsJson = JSON.stringify(argumentsValue)
    return {
      kind: 'tool_calls',
      calls: [1, 2].map((ordinal) => ({
        toolCallId: `golden_call_${input.requestOrdinal}_${toolName}_duplicate_${String(ordinal)}`,
        toolName,
        argumentsJson,
      })),
    }
  }
  return {
    kind: 'tool_call',
    toolCallId: `golden_call_${input.requestOrdinal}_${toolName}`,
    toolName,
    argumentsJson: JSON.stringify(argumentsValue),
  }
}
