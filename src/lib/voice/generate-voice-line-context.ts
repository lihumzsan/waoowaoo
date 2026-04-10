import type { Locale } from '@/i18n/routing'
import { getModelsByType, getProviderKey } from '@/lib/api-config'
import { composeModelKey, getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import {
  buildFishAudioS2RenderText,
  generateFishAudioS2LinePrompt,
  type VoiceDesignCharacterContext,
} from '@/lib/voice-design/fish-audio-s2'

const PREFERRED_BAILIAN_TEXT_MODEL_IDS = [
  'qwen3.5-plus',
  'qwen3.5-flash',
  'qwen-plus',
  'qwen-turbo',
] as const

export interface VoiceLineContextCharacter {
  name: string
  aliases?: string | null
  introduction?: string | null
  profileData?: string | null
  appearances?: Array<{
    changeReason?: string | null
    description?: string | null
  }> | null
}

export interface VoiceLineContextLine {
  lineIndex: number
  speaker: string
  content: string
}

export interface VoiceLineContextStoryboard {
  id: string
  clip?: {
    content?: string | null
  } | null
  panels?: Array<{
    panelIndex: number
    srtSegment?: string | null
    description?: string | null
    characters?: string | null
  }>
}

export interface BuildComfyUiLineRenderTextInput {
  userId: string
  locale: Locale
  projectId: string
  workflowKey: string
  speakerName: string
  lineIndex: number
  lineText: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
  character?: VoiceLineContextCharacter | null
  voiceLines?: VoiceLineContextLine[] | null
  storyboards?: VoiceLineContextStoryboard[] | null
}

export interface BuildComfyUiLineRenderTextResult {
  renderText: string
  derivedEmotionPrompt: string | null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncateText(value: unknown, maxLength: number): string {
  const text = readTrimmedString(value).replace(/\s+/g, ' ')
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function normalizeEmotionPrompt(value: string | null | undefined): string | null {
  const prompt = readTrimmedString(value)
  return prompt || null
}

function shouldUseFishAudioS2LinePrompt(workflowKey: string): boolean {
  const normalized = workflowKey.trim().toLowerCase()
  return normalized.includes('s2') || normalized.includes('longcat')
}

function toCharacterContext(character?: VoiceLineContextCharacter | null): VoiceDesignCharacterContext | null {
  if (!character) return null
  return {
    name: character.name,
    aliases: character.aliases,
    introduction: character.introduction,
    profileData: character.profileData,
    appearances: Array.isArray(character.appearances)
      ? character.appearances.map((appearance) => ({
        label: appearance.changeReason,
        description: appearance.description,
      }))
      : [],
  }
}

function buildDialogueContext(lines: VoiceLineContextLine[] | null | undefined, currentLineIndex: number): string {
  if (!Array.isArray(lines) || lines.length === 0) {
    return '未提供额外对白上下文。'
  }

  const nearbyLines = lines
    .filter((line) => Number.isFinite(line.lineIndex) && Math.abs(line.lineIndex - currentLineIndex) <= 2)
    .sort((a, b) => a.lineIndex - b.lineIndex)

  if (nearbyLines.length === 0) {
    return '未提供额外对白上下文。'
  }

  return nearbyLines
    .map((line) => {
      const content = truncateText(line.content, 120)
      return `#${line.lineIndex} ${line.speaker}: ${content}`
    })
    .join('\n')
}

function buildSceneContext(
  storyboards: VoiceLineContextStoryboard[] | null | undefined,
  currentLineIndex: number,
): string {
  if (!Array.isArray(storyboards) || storyboards.length === 0) {
    return '未提供明确分镜上下文。'
  }

  const fragments: string[] = []
  for (const storyboard of storyboards) {
    const clipContent = truncateText(storyboard.clip?.content, 160)
    const matchedPanels = (storyboard.panels || [])
      .filter((panel) => {
        const textSegment = truncateText(panel.srtSegment, 80)
        return textSegment.length > 0
      })
      .slice(0, 3)

    if (!clipContent && matchedPanels.length === 0) {
      continue
    }

    if (clipContent) {
      fragments.push(`片段内容：${clipContent}`)
    }

    for (const panel of matchedPanels) {
      const parts = [
        truncateText(panel.srtSegment, 80),
        truncateText(panel.description, 100),
        truncateText(panel.characters, 60),
      ].filter(Boolean)
      if (parts.length === 0) continue
      fragments.push(`分镜${panel.panelIndex + 1}：${parts.join('；')}`)
    }

    if (fragments.length >= 4) break
  }

  if (fragments.length === 0) {
    return `当前为第 ${currentLineIndex} 句台词，未找到可用分镜描述。`
  }

  return fragments.slice(0, 4).join('\n')
}

async function resolveVoiceLineTextModel(userId: string, projectId: string): Promise<string | null> {
  const projectConfig = await getProjectModelConfig(projectId, userId)
  if (projectConfig.analysisModel && getProviderKey(projectConfig.analysisModel) === 'bailian') {
    return projectConfig.analysisModel
  }

  const userConfig = await getUserModelConfig(userId)
  if (userConfig.analysisModel && getProviderKey(userConfig.analysisModel) === 'bailian') {
    return userConfig.analysisModel
  }

  const llmModels = await getModelsByType(userId, 'llm')
  const bailianModels = llmModels.filter((model) => getProviderKey(model.provider) === 'bailian')

  for (const modelId of PREFERRED_BAILIAN_TEXT_MODEL_IDS) {
    const matched = bailianModels.find((model) => model.modelId === modelId)
    if (matched) {
      return composeModelKey(matched.provider, matched.modelId)
    }
  }

  if (bailianModels[0]) {
    return composeModelKey(bailianModels[0].provider, bailianModels[0].modelId)
  }

  return null
}

export async function buildComfyUiLineRenderText(
  input: BuildComfyUiLineRenderTextInput,
): Promise<BuildComfyUiLineRenderTextResult> {
  const lineText = readTrimmedString(input.lineText)
  const emotionPrompt = normalizeEmotionPrompt(input.emotionPrompt)
  if (!lineText) {
    return {
      renderText: '',
      derivedEmotionPrompt: emotionPrompt,
    }
  }

  if (!shouldUseFishAudioS2LinePrompt(input.workflowKey)) {
    return {
      renderText: lineText,
      derivedEmotionPrompt: emotionPrompt,
    }
  }

  const textModel = await resolveVoiceLineTextModel(input.userId, input.projectId)
  if (!textModel) {
    return {
      renderText: buildFishAudioS2RenderText({
        fishText: lineText,
        voicePrompt: emotionPrompt,
        userVoicePrompt: emotionPrompt,
      }),
      derivedEmotionPrompt: emotionPrompt,
    }
  }

  const promptResult = await generateFishAudioS2LinePrompt({
    userId: input.userId,
    locale: input.locale,
    model: textModel,
    projectId: input.projectId,
    speakerName: input.speakerName,
    lineText,
    emotionPrompt,
    emotionStrength: input.emotionStrength ?? null,
    character: toCharacterContext(input.character),
    dialogueContext: buildDialogueContext(input.voiceLines, input.lineIndex),
    sceneContext: buildSceneContext(input.storyboards, input.lineIndex),
  })

  return {
    renderText: buildFishAudioS2RenderText({
      fishText: promptResult.fishText,
      voicePrompt: promptResult.voicePrompt,
      userVoicePrompt: emotionPrompt,
    }),
    derivedEmotionPrompt: normalizeEmotionPrompt(promptResult.voicePrompt) || emotionPrompt,
  }
}
