import { createHash } from 'crypto'
import type { Locale } from '@/i18n/routing'
import { prisma } from '@/lib/prisma'
import { editScriptStyleBibleSchema, type EditScriptStyleBible } from './types'

export type StyleBiblePromptUsage = 'assetImage' | 'storyboardImage' | 'video'

type StyleBibleCarrier = {
  readonly styleBibleJson: unknown
} | null

function trimText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function joinLines(lines: ReadonlyArray<string | null | undefined>): string {
  return lines
    .map((line) => trimText(line))
    .filter((line): line is string => line !== null)
    .join('\n')
}

function appendBlock(base: string, block: string): string {
  const trimmedBase = base.trim()
  const trimmedBlock = block.trim()
  if (!trimmedBlock) return trimmedBase
  if (!trimmedBase) return trimmedBlock
  return `${trimmedBase}\n\n${trimmedBlock}`
}

export function parseNullableEditScriptStyleBible(value: unknown): EditScriptStyleBible | null {
  if (value === null || value === undefined) return null
  const parsed = editScriptStyleBibleSchema.safeParse({ styleBible: value })
  if (!parsed.success) {
    throw new Error('EDIT_SCRIPT_STYLE_BIBLE_INVALID')
  }
  return parsed.data.styleBible
}

function styleBibleFromCarrier(carrier: StyleBibleCarrier): EditScriptStyleBible | null {
  if (!carrier) return null
  return parseNullableEditScriptStyleBible(carrier.styleBibleJson)
}

export async function resolveEditScriptStyleBibleForTask(input: {
  readonly projectId: string
  readonly episodeId?: string | null
}): Promise<EditScriptStyleBible | null> {
  const episodeId = trimText(input.episodeId)
  if (!episodeId) return null

  const editBible = await prisma.projectEditBible.findFirst({
    where: {
      episodeId,
      episode: { projectId: input.projectId },
    },
    select: {
      styleBibleJson: true,
    },
  })
  return styleBibleFromCarrier(editBible)
}

export async function resolveEditScriptStyleBibleForStoryboardTask(input: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly storyboardId?: string | null
}): Promise<EditScriptStyleBible | null> {
  const episodeId = trimText(input.episodeId)
  if (episodeId) {
    return await resolveEditScriptStyleBibleForTask({
      projectId: input.projectId,
      episodeId,
    })
  }

  const storyboardId = trimText(input.storyboardId)
  if (!storyboardId) return null
  const storyboard = await prisma.projectStoryboard.findUnique({
    where: { id: storyboardId },
    select: { episodeId: true },
  })
  return await resolveEditScriptStyleBibleForTask({
    projectId: input.projectId,
    episodeId: storyboard?.episodeId ?? null,
  })
}

export async function resolveEditScriptStyleBibleSignatureForTask(input: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly storyboardId?: string | null
}): Promise<string> {
  const styleBible = await resolveEditScriptStyleBibleForStoryboardTask(input)
  if (!styleBible) return 'style-bible:none'
  const digest = createHash('sha1')
    .update(JSON.stringify(styleBible))
    .digest('hex')
    .slice(0, 16)
  return `style-bible:${digest}`
}

function renderVisualLines(styleBible: EditScriptStyleBible, locale: Locale, usage: StyleBiblePromptUsage): string[] {
  const visual = styleBible.stylePolicy.visual
  if (locale === 'en') {
    const base = [
      `Image filter: ${visual.imageFilterPrompt}`,
      `Lighting: ${visual.lightingPrompt}`,
      `Color: ${visual.colorPrompt}`,
      usage === 'assetImage' ? `Texture: ${visual.texturePrompt}` : null,
      usage === 'video' ? null : `Composition: ${visual.compositionPrompt}`,
    ]
    return base.filter((line): line is string => typeof line === 'string')
  }
  const base = [
    `画面滤镜：${visual.imageFilterPrompt}`,
    `光线：${visual.lightingPrompt}`,
    `色彩：${visual.colorPrompt}`,
    usage === 'assetImage' ? `质感：${visual.texturePrompt}` : null,
    usage === 'video' ? null : `构图：${visual.compositionPrompt}`,
  ]
  return base.filter((line): line is string => typeof line === 'string')
}

function renderCameraLines(styleBible: EditScriptStyleBible, locale: Locale, usage: StyleBiblePromptUsage): string[] {
  const camera = styleBible.stylePolicy.camera
  if (locale === 'en') {
    const base = [
      `Camera movement: ${camera.movementPrompt}`,
      `Lens and depth: ${camera.lensAndDepthPrompt}`,
      usage === 'video' ? `Video rhythm: ${camera.videoRhythmPrompt}` : null,
    ]
    return base.filter((line): line is string => typeof line === 'string')
  }
  const base = [
    `运镜：${camera.movementPrompt}`,
    `镜头与景深：${camera.lensAndDepthPrompt}`,
  ]
  if (usage === 'video') base.push(`视频节奏：${camera.videoRhythmPrompt}`)
  return base
}

function renderSoundLines(styleBible: EditScriptStyleBible, locale: Locale): string[] {
  const sound = styleBible.stylePolicy.sound
  if (locale === 'en') {
    return [
      `Sound filter: ${sound.soundFilterPrompt}`,
    ]
  }
  return [
    `声音滤镜：${sound.soundFilterPrompt}`,
  ]
}

export function renderStyleBiblePromptBlock(input: {
  readonly styleBible: EditScriptStyleBible
  readonly usage: StyleBiblePromptUsage
  readonly locale: Locale
}): string {
  const { styleBible, usage, locale } = input
  const title = locale === 'en'
    ? 'System Style Bible requirements, fixed append, must follow:'
    : '系统 Style Bible 视觉要求（固定追加，必须遵守）：'
  const usageLine = (() => {
    if (locale === 'en') {
      if (usage === 'assetImage') return 'Usage: asset image generation. Apply these visual rules to the generated asset itself.'
      if (usage === 'storyboardImage') return 'Usage: storyboard image generation. Apply these visual and camera rules to the whole frame.'
      return 'Usage: final video generation. Apply these visual, camera, and sound-filter rules to the generated video.'
    }
    if (usage === 'assetImage') return '用途：资产图生成。将这些视觉规则应用到资产本身。'
    if (usage === 'storyboardImage') return '用途：分镜图生成。将这些视觉与镜头规则应用到整张画面。'
    return '用途：最终视频生成。将这些视觉、镜头与声音滤镜规则应用到生成视频。'
  })()

  const lines = [
    title,
    usageLine,
    ...renderVisualLines(styleBible, locale, usage),
    ...(usage === 'assetImage' ? [] : renderCameraLines(styleBible, locale, usage)),
    ...(usage === 'video' ? renderSoundLines(styleBible, locale) : []),
  ]

  return joinLines(lines)
}

export function appendStyleBiblePromptBlock(input: {
  readonly prompt: string
  readonly styleBible: EditScriptStyleBible | null
  readonly usage: StyleBiblePromptUsage
  readonly locale: Locale
}): string {
  if (!input.styleBible) return input.prompt
  return appendBlock(input.prompt, renderStyleBiblePromptBlock({
    styleBible: input.styleBible,
    usage: input.usage,
    locale: input.locale,
  }))
}
