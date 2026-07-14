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
      '# Voice and communication',
      'Announcing tool calls:',
      '# Operating principles',
      'Parallel operation groups: when `workflowOperationGroupIds` is non-empty',
      '# Authoritative state and when to read',
      '# The turn loop',
      'Task update: a `[task_update]`',
      'data.noop=true',
      '# Failure handling and retry boundaries',
      'Transient external-service errors, network/timeouts',
      '# Hard constraints',
      'Visual safety: never choose or generate real-person',
      '# Edit-first workflow',
      '# Edit-first stage rules',
      'Before the bible:',
      'Script confirmation:',
      'Production-plan confirmation:',
      'Visual style:',
      'Asset review:',
      'Shot, video, and audio:',
      '`generate_video_segments` is the only video-segment generation entry.',
      '# Permission mode',
      'This controls execution approval only, never content choices.',
      '# Current context',
      'Choice tools are governed by `workflowStatus` and `enabledOperationIds`',
      'When `workflowRecommendedOperation` is non-empty and appears in both `allowedOperationIds` and `enabledOperationIds`',
      'When `workflowStatus=needs_user_choice` and `enabledOperationIds` contains the current-stage choice tool',
      'A prose question, artifact presentation, or statement such as "please confirm" does not count as completion.',
    ],
    zh: [
      '# 身份',
      '# 文风与沟通',
      '工具调用说明：',
      '# 行为原则',
      '并行操作组：当 `workflowOperationGroupIds` 非空时',
      '# 权威状态与读取规则',
      '# 每轮循环',
      '任务更新：`[task_update]`',
      'data.noop=true',
      '# 失败处理与重试边界',
      '临时外部服务错误、网络/超时',
      '# 硬约束',
      '视觉安全：不要选择或生成真人',
      '# 剪辑先行工作流',
      '# 剪辑先行阶段规则',
      'Bible 前：',
      '剧本确认：',
      '制作规划确认：',
      '视觉风格：',
      '资产审核：',
      '镜头、视频与音频：',
      '`generate_video_segments` 是唯一视频片段生成入口。',
      '# 权限模式',
      '该模式只影响执行审批，不影响内容选择。',
      '# 当前上下文',
      'Choice 工具由 `workflowStatus` 与 `enabledOperationIds` 共同约束',
      '`workflowRecommendedOperation` 非空且同时出现在 `allowedOperationIds` 与 `enabledOperationIds`',
      '`workflowStatus=needs_user_choice` 且 `enabledOperationIds` 中存在当前阶段的选择工具',
      '纯文字提问、展示内容或说明“请确认”不算完成。',
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
