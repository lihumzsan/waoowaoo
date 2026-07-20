#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/ai-prompt-output-contract.md (AP-01, AP-03).

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const chineseCharPattern = /[\p{Script=Han}]/u
const singlePlaceholderPattern = /\{([A-Za-z0-9_]+)\}/g
const doublePlaceholderPattern = /\{\{([A-Za-z0-9_]+)\}\}/g

const criticalTemplateTokens = new Map([
  ['edit-script/style-bible', ['"rawUserStyle"', '"styleSummary"', '"visualStyle"', '"assetImageStyle"']],
  ['edit-script/structure', ['"generationSegments"', '"scene"', '"action"', '"performance"', '"dialogue"', '"synchronousSound"', '"continuity"', '"soundCues"', '"startSec"', '"endSec"', '"sourceShotRef"']],
  ['edit-script/shot-execution-plan', ['"shotScale"', '"cameraMovement"', '"movement"', '"stability"']],
])

const criticalLocalizedTemplateTokens = new Map([
  ['project-agent/system', {
    en: [
      '# Identity',
      '# Core loop',
      'At the start of every turn and after every tool result',
      'Before the first tool call, give one natural sentence',
      'one model step may emit multiple independent calls',
      'Submitting background Tasks is not.',
      'A separate background Run and aggregate Wait own the Tasks',
      'the system starts exactly one background continuation',
      'Do not poll background Tasks.',
      '# Tool availability and recommended mainline',
      'Every injected tool is callable.',
      '`mainlineStep`, `mainlineStatus`, `mainlineStatusReason`, and `mainlineRecommendedOperation` help planning only',
      'It is planning discipline for the primary Agent, not a tool gate',
      '# Resource rules',
      '`create_text`, `create_image`, `create_audio`, and `create_video` can be called from an empty project.',
      'Professional Operations remain available.',
      '# Creative Worker and general creative capabilities',
      '`delegate_creative_work` is the primary Agent\'s only delegation entry for professional creative results.',
      '`delegation.source=requests` submits one or more caller-complete requests',
      '`delegation.source=chapters` asks the server to compile minimal context',
      'Every request becomes one background `CREATIVE_WORK` Task.',
      'Do not specify Skill ids for the Worker',
      'the continuation after every Task reaches a terminal state returns only completion summaries.',
      'call `get_task` with the exact `taskId` from its receipt',
      'A Bible Task completion only resumes the primary Agent',
      'When the user has already specified a sufficiently concrete style',
      'Preview images are optional billable media, never an adoption prerequisite.',
      '`adopt_style_bible`',
      'pass its `generationPrompt` directly to the real image Operation',
      'Delegate `edit_bible_bundle`',
      '`save_edit_source`',
      '`adopt_edit_bible_bundle`',
      '# Video production routing',
      'Total duration at most 15 seconds',
      'Total duration over 15 and at most 180 seconds',
      'Total duration over 180 seconds',
      'must never prescribe segment count, per-segment duration',
      '`segment.prompt` unchanged as the final video prompt',
      'resolve `referenceKeys` to exact image revisions',
      'the required Style Bible',
      'This long-work recipe governs the primary Agent\'s planning quality',
      '# Freeform production loop',
      '# Result inspection and correction',
      '# Optional professional capabilities',
      'References must use the exact `resourceId + revisionId + fingerprint` tuple.',
      '`contextReferences`',
      '`imageReferences`',
      'Retry only failed Resources.',
      'Lineage means “this revision was generated from these exact inputs.”',
      '# Billing, choices, and destructive actions',
      'Billable Operations always use the existing immutable quote plan.',
      "The system follows the user's setting to show a quote card or authorize that exact quote automatically.",
      'Use the existing Choice tool when structured selection is appropriate',
      '# Failure and retry',
      'Explain failures truthfully with error.code and error.message',
      'The queue owns automatic retry of individual execution attempts.',
      'Never fabricate text, image, video, or audio output',
      '# Communication',
      '# Visual safety',
      'Do not select or generate real people',
      '# Current context',
    ],
    zh: [
      '# 身份',
      '# 核心循环',
      '每轮以及每次工具返回后都重新执行',
      '第一次调用前先用一句自然语言说明准备做什么',
      '同一次模型步骤中发出多个相互独立的调用',
      '提交后台 Task 不是。',
      '后台 Task 由独立 Run 和聚合 Wait 管理',
      '系统会只触发一次后台续跑',
      '不轮询后台 Task。',
      '# 工具可用性与主链路',
      '所有注入工具都可调用；可调用与推荐调用严格分开。',
      '`mainlineStep`、`mainlineStatus`、`mainlineStatusReason`、`mainlineRecommendedOperation` 只用于帮助规划',
      '它是主 Agent 的规划纪律，不是工具门禁',
      '# Resource 规则',
      '`create_text`、`create_image`、`create_audio`、`create_video` 可从空项目直接调用。',
      '专业 Operation 保持可用',
      '# Creative Worker 与通用创作能力',
      '`delegate_creative_work` 是主 Agent 获取专业创作结果的唯一委派入口。',
      '`delegation.source=requests` 提交一个或多个调用方已备齐上下文的请求',
      '`delegation.source=chapters` 让服务端为多个持久 Chapter 编译最小上下文',
      '每个请求都成为一个后台 `CREATIVE_WORK` Task。',
      '不要替 Worker 指定 Skill id',
      'Task 全部终态后的续跑只返回完成摘要。',
      '用该回执中的精确 `taskId` 调用 `get_task` 读取',
      'Bible Task 完成只会恢复主 Agent',
      '用户已经明确给出足够具体的风格时',
      '预览图是可选的收费媒体，不是采用前置。',
      '`adopt_style_bible`',
      '把 `generationPrompt` 直接交给真实图片 Operation',
      '委派 `edit_bible_bundle`',
      '`save_edit_source`',
      '`adopt_edit_bible_bundle`',
      '# 视频制作路由',
      '总时长不超过 15 秒',
      '总时长大于 15 秒且不超过 180 秒',
      '总时长大于 180 秒',
      '严禁指定“几段”“每段几秒”',
      '`segment.prompt` 原样作为最终视频提示词',
      '按 `referenceKeys` 映射精确图片 revision',
      '必需 Style Bible',
      '这套长作品配方约束的是主 Agent 在特定目标下的规划质量',
      '# 自由制作循环',
      '# 结果检查与修正',
      '# 可选专业能力',
      '引用必须使用 `resourceId + revisionId + fingerprint` 的精确组合。',
      '`contextReferences`',
      '`imageReferences`',
      '只重试失败的 Resource。',
      'Lineage 只表示“这个版本由哪些精确输入生成”',
      '# 收费、选择与破坏性动作',
      '收费 Operation 始终使用系统现有的不可变报价计划',
      '系统会按用户设置决定展示报价卡或自动授权同一份报价。',
      '适合结构化选择时调用既有 Choice 工具',
      '# 失败与重试',
      '如实使用 error.code 与 error.message 说明失败',
      '队列会处理单次执行尝试的自动重试',
      '不用伪造文字、图片、视频或音频',
      '# 沟通风格',
      '# 视觉安全',
      '不要选择或生成真人',
      '# 当前上下文',
    ],
  }],
])

const forbiddenLocalizedTemplateTokens = new Map([
  ['project-agent/system', {
    en: [
      'selectedPanelId',
      'storyboardId',
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      'structured repair loop',
      'spatial profiles',
      'storyboard panels',
      'storyboard images',
      'workflowOperationGroupIds',
      'allowedOperationIds',
      'enabledOperationIds',
      'story_analysis',
      '`generate_video_segments` is the only video-segment generation entry.',
      '# Video direction and generation',
    ],
    zh: [
      'selectedPanelId',
      'storyboardId',
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      '结构化修复轮',
      '空间档案',
      '分镜面板',
      '分镜图片',
      'workflowOperationGroupIds',
      'allowedOperationIds',
      'enabledOperationIds',
      'story_analysis',
      '`generate_video_segments` 是唯一视频片段生成入口。',
      '# 视频导演与生成',
    ],
  }],
])

const criticalCreativeSkillTokens = new Map([
  ['creative-core', {
    en: ['# Creative Core', '# Facts, inferences, and creative additions', 'shortest sufficient path'],
    zh: ['# 创作核心', '事实、推断与创作补充', '最短充分路径'],
  }],
  ['story-development', {
    en: ['# Story Development', 'Runtime comes from dialogue, action, reaction, pauses, and transitions', 'Scene body text must be a complete filmable scene'],
    zh: ['# 故事与剧本开发', '时长来自对白、动作、反应、停顿和转场的实际时间', '真正可拍摄的完整场景'],
  }],
  ['continuity-memory', {
    en: ['# Continuity Memory', 'The source text is the only factual authority.', '## Minimum sufficient chapter context'],
    zh: ['# 连续性记忆', '原文是唯一事实来源。', '面向章节的最小充分上下文'],
  }],
  ['director-core', {
    en: ['# Director and Production Timeline Core', 'Do not split one unfinished action across independent generations.', 'pack continuous material toward the maximum allowed duration', 'add only scale, primary movement, and stability'],
    zh: ['# 导演与制作时间线核心', '不把一个未完成动作切到两次独立生成中。', '把可连续的内容装到最大允许时长', '只补景别、主要运镜和稳定性'],
  }],
  ['style-development', {
    en: ['# Visual Style Development', '`visualStyle` is the shared image/video look', '`assetImageStyle` is used only for asset images', 'Video generation consumes only `visualStyle`', 'Candidates must differ materially', 'must not change character identity', 'The Style Bible is the sole authority for visual style'],
    zh: ['# 视觉风格开发', '`visualStyle` 是图片和视频共享的总体画面风格', '`assetImageStyle` 只供角色图', '视频生成只消费 `visualStyle`', '候选应在美术媒介、总体质感、色彩与设计语言上形成实质差异', '不得借预览改变人物身份', 'Style Bible 是视觉风格的唯一权威'],
  }],
  ['asset-development', {
    en: ['# Asset Development and Generation Prompts', 'Assets may be designed independently when no Style Bible exists', '`stableDescription`', '`generationPrompt`', 'Shoes are mandatory', '### Non-human characters', 'Do not use uncertainty', 'at least three stable, clearly visible spatial anchors', 'clear, sharp, richly detailed, and production-quality', 'occupation- or identity-specific pose/context samples', 'foundational location description stored as project fact', "Describe only the prop's static visible body", 'Preserve every unmodified identity'],
    zh: ['# 资产设计与生成提示词', '资产可以在没有 Style Bible 时独立设计', '`stableDescription`', '`generationPrompt`', '鞋子是完整人物设计的必要部分', '### 非人类角色', '不用“或”“可能”“也许”“大概”等不确定词', '至少三个稳定、清晰可见的空间锚点', '清晰锐利、细节丰富并达到专业生产质量', '与职业或身份相符、可复用于分镜的轻微姿态或语境样本', '作为项目事实保存的基础地点描述', '只描述道具本体的静态视觉信息', '保留所有未被修改的原有身份'],
  }],
  ['video-direction', {
    en: ['# Video Direction and Generation Design', 'finalized Style Bible with exact provenance', 'explicitly ordered reference manifest', 'one final video prompt', '“cut to the location in image N”', 'one to three core actions', 'ignore caller prose that prescribes', 'do not split material that naturally fits one 15-second generation', 'never divide one unfinished action across two generations', '`{spoken line}`', '`<sound description>`', '**No dissolves or fades**', 'No dissolves, cross-dissolves, fade-ins, or fade-outs between shots', '**Dark/black bridge**', 'this is not a fade to black or fade in from black', '**Montage transition**', '**Metaphorical transition**', '**Creative transition**', 'Do not use one at every scene boundary', '## Excellent complete prompt examples', '### Example one: one scene without a creative transition', '### Example three: a motivated dark and metaphorical transition', "### Example four: this version's complete audiovisual prompt", '**Sound relationship choice:**', 'The sound-relationship judgment is required, but a special cue is not', 'Native audio is enabled by default', '## Dialogue, sound, and native audio'],
    zh: ['# 视频导演与生成设计', '已经确认并具有精确来源的最终 Style Bible', '有明确顺序的参考清单', '唯一一份最终视频提示词', '“镜头切至图片N中的……”', '一到三个核心动作', '忽略调用方文字里预设的', '能自然承载 15 秒的内容就不要拆成多个更短片段', '不把一个未完成动作切到两次独立生成', '`{逐字台词}`', '`<声音描述>`', '**禁止叠化和淡入淡出**', '镜头之间禁止叠化、交叉溶解、淡入和淡出', '**黑暗/黑场衔接**', '这不是淡出黑场或淡入新画面', '**蒙太奇转场**', '**隐喻转场**', '**创意转场**', '不是每个场景都用', '## 优秀完整提示词示例', '### 示例一：同一场景，不使用创意转场', '### 示例三：有动机的黑暗与隐喻转场', '### 示例四：本版本综合音画提示词', '**声音关系选择：**', '声音关系判断必须做，但特殊 cue 不是必选项', '视频生成默认开启原生音频', '## 对白、声音和原生音频'],
  }],
  ['music-direction', {
    en: ['# Music and Score Direction', 'one unified but continuously changing instrumental BGM score', 'Reserve midrange space for dialogue', '`videoRatio` and a Style Bible', 'soundstage width/depth, rhythmic density, and orchestration direction'],
    zh: ['# 音乐与配乐设计', '统一但持续变化的纯器乐 BGM', '为对白和旁白保留中频空间', '`videoRatio` 与 Style Bible', '音乐气质、声场宽度与纵深、节奏密度和配器取向'],
  }],
  ['quality-review', {
    en: ['# Creative Quality Review', 'Use actually visible evidence', 'minimum correction scope'],
    zh: ['# 创作质量审查', '根据真实可见输入', '最小范围修正'],
  }],
])

function fail(title, details = []) {
  console.error(`\n[prompt-semantic-regression] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

function parseCatalog(text) {
  const entries = []
  const promptIds = parsePromptIds()
  const entryPattern = /\[AI_PROMPT_IDS\.([A-Z0-9_]+)\]:\s*\{([\s\S]*?)\n  \},/g
  for (const match of text.matchAll(entryPattern)) {
    const promptId = promptIds.get(match[1])
    const body = match[2] || ''
    const pathStem = body.match(/pathStem:\s*'([^']+)'/)?.[1]
    const rawKeys = body.match(/variableKeys:\s*\[([\s\S]*?)\]/)?.[1] || ''
    const keys = Array.from(rawKeys.matchAll(/'([^']+)'/g)).map((item) => item[1])
    if (promptId && pathStem) entries.push({ promptId, pathStem, variableKeys: keys })
  }
  return entries
}

function parsePromptIds() {
  const idsPath = path.join(root, 'src', 'lib', 'ai-prompts', 'ids.ts')
  if (!fs.existsSync(idsPath)) {
    fail('ids.ts not found', ['src/lib/ai-prompts/ids.ts'])
  }
  const idsText = fs.readFileSync(idsPath, 'utf8')
  return new Map(
    Array.from(idsText.matchAll(/\b([A-Z0-9_]+):\s*'([^']+)'/g))
      .map((match) => [match[1], match[2]]),
  )
}

function extractPlaceholders(template) {
  const keys = new Set()
  for (const match of template.matchAll(singlePlaceholderPattern)) {
    if (match[1]) keys.add(match[1])
  }
  for (const match of template.matchAll(doublePlaceholderPattern)) {
    if (match[1]) keys.add(match[1])
  }
  return Array.from(keys)
}

const registryPath = path.join(root, 'src', 'lib', 'ai-prompts', 'registry.ts')
if (!fs.existsSync(registryPath)) {
  fail('registry.ts not found', ['src/lib/ai-prompts/registry.ts'])
}

const catalogText = fs.readFileSync(registryPath, 'utf8')
const entries = parseCatalog(catalogText)
if (entries.length === 0) {
  fail('failed to parse AI prompt catalog entries')
}

const violations = []
for (const entry of entries) {
  const templatePath = path.join(root, 'src', 'lib', 'ai-prompts', 'templates', entry.pathStem, `${entry.promptId}.en.txt`)
  const relTemplatePath = `src/lib/ai-prompts/templates/${entry.pathStem}/${entry.promptId}.en.txt`
  if (!fs.existsSync(templatePath)) {
    violations.push(`missing template: ${relTemplatePath}`)
    continue
  }

  const template = fs.readFileSync(templatePath, 'utf8')
  if (chineseCharPattern.test(template)) {
    violations.push(`unexpected Chinese content in English template: ${relTemplatePath}`)
  }

  const placeholders = extractPlaceholders(template)
  const placeholderSet = new Set(placeholders)
  const variableKeySet = new Set(entry.variableKeys)

  for (const key of entry.variableKeys) {
    if (!placeholderSet.has(key)) {
      violations.push(`missing placeholder {${key}} in ${relTemplatePath}`)
    }
  }

  for (const key of placeholders) {
    if (!variableKeySet.has(key)) {
      violations.push(`unexpected placeholder {${key}} in ${relTemplatePath}`)
    }
  }

  const requiredTokens = criticalTemplateTokens.get(entry.pathStem) || []
  for (const token of requiredTokens) {
    if (!template.includes(token)) {
      violations.push(`missing semantic token ${token} in ${relTemplatePath}`)
    }
  }

  const localizedTokens = criticalLocalizedTemplateTokens.get(entry.pathStem)
  for (const [locale, tokens] of Object.entries(localizedTokens || {})) {
    const localizedTemplatePath = path.join(root, 'src', 'lib', 'ai-prompts', 'templates', entry.pathStem, `${entry.promptId}.${locale}.txt`)
    const relLocalizedTemplatePath = `src/lib/ai-prompts/templates/${entry.pathStem}/${entry.promptId}.${locale}.txt`
    if (!fs.existsSync(localizedTemplatePath)) {
      violations.push(`missing localized semantic template: ${relLocalizedTemplatePath}`)
      continue
    }
    const localizedTemplate = fs.readFileSync(localizedTemplatePath, 'utf8')
    for (const token of tokens) {
      if (!localizedTemplate.includes(token)) {
        violations.push(`missing semantic token ${token} in ${relLocalizedTemplatePath}`)
      }
    }
  }

  const forbiddenLocalizedTokens = forbiddenLocalizedTemplateTokens.get(entry.pathStem)
  for (const [locale, tokens] of Object.entries(forbiddenLocalizedTokens || {})) {
    const localizedTemplatePath = path.join(root, 'src', 'lib', 'ai-prompts', 'templates', entry.pathStem, `${entry.promptId}.${locale}.txt`)
    const relLocalizedTemplatePath = `src/lib/ai-prompts/templates/${entry.pathStem}/${entry.promptId}.${locale}.txt`
    if (!fs.existsSync(localizedTemplatePath)) continue
    const localizedTemplate = fs.readFileSync(localizedTemplatePath, 'utf8')
    for (const token of tokens) {
      if (localizedTemplate.includes(token)) {
        violations.push(`forbidden legacy semantic token ${token} in ${relLocalizedTemplatePath}`)
      }
    }
  }
}

for (const [skillId, localizedTokens] of criticalCreativeSkillTokens) {
  const skillDir = path.join(root, 'src', 'lib', 'creative-skills', 'skills', skillId)
  for (const [locale, tokens] of Object.entries(localizedTokens)) {
    const skillPath = path.join(skillDir, `SKILL.${locale}.md`)
    const relativeSkillPath = `src/lib/creative-skills/skills/${skillId}/SKILL.${locale}.md`
    if (!fs.existsSync(skillPath)) {
      violations.push(`missing Creative Skill resource: ${relativeSkillPath}`)
      continue
    }
    const skill = fs.readFileSync(skillPath, 'utf8')
    for (const token of tokens) {
      if (!skill.includes(token)) {
        violations.push(`missing Creative Skill semantic token ${token} in ${relativeSkillPath}`)
      }
    }
  }
}

if (violations.length > 0) {
  fail('semantic regression check failed', violations)
}

console.log(`[prompt-semantic-regression] OK (${entries.length} templates checked)`)
