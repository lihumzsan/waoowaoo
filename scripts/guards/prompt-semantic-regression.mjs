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
  ['edit-script/structure', ['"generationSegments"', '"scene"', '"action"', '"performance"', '"dialogue"', '"synchronousSound"', '"continuity"']],
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
      'This is a Playbook, not a state machine.',
      '# Resource rules',
      '`create_text`, `create_image`, `create_audio`, and `create_video` can be called from an empty project.',
      'Professional Operations remain available.',
      '# General creative capabilities',
      '# Freeform production loop',
      '# Video direction and generation',
      'The Nth item in the `references` array is “Image N” in the final video prompt.',
      'use only the lightweight marker “Cut to the location in Image N,”',
      '# Result inspection and correction',
      '# Optional professional capabilities',
      'References must use the exact `resourceId + revisionId + fingerprint` tuple.',
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
      '它是 Playbook，不是状态机',
      '# Resource 规则',
      '`create_text`、`create_image`、`create_audio`、`create_video` 可从空项目直接调用。',
      '专业 Operation 保持可用',
      '# 通用创作能力',
      '# 自由制作循环',
      '# 视频导演与生成',
      '`references` 数组中的第 N 张图片对应最终视频 prompt 中的“图片N”。',
      '只使用“镜头切至图片N中的……”这一轻量标记',
      '# 结果检查与修正',
      '# 可选专业能力',
      '引用必须使用 `resourceId + revisionId + fingerprint` 的精确组合。',
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
      '`generate_video_segments` is the only video-segment generation entry.',
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
      '`generate_video_segments` 是唯一视频片段生成入口。',
    ],
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

if (violations.length > 0) {
  fail('semantic regression check failed', violations)
}

console.log(`[prompt-semantic-regression] OK (${entries.length} templates checked)`)
