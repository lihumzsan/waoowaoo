import { createHash } from 'crypto'
import type { Locale } from '@/i18n/routing'
import { prisma } from '@/lib/prisma'
import { editScriptStyleBibleSchema, type EditScriptStyleBible } from './types'

export type StyleBiblePromptUsage = 'assetImage' | 'video'

function trimText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
  if (!parsed.success) throw new Error('EDIT_SCRIPT_STYLE_BIBLE_INVALID')
  return parsed.data.styleBible
}

export async function resolveEditScriptStyleBibleForTask(input: {
  readonly projectId: string
  readonly episodeId?: string | null
}): Promise<EditScriptStyleBible | null> {
  const episodeId = trimText(input.episodeId)
  if (!episodeId) return null
  const editBible = await prisma.projectEditBible.findFirst({
    where: { episodeId, episode: { projectId: input.projectId } },
    select: { styleBibleJson: true },
  })
  return parseNullableEditScriptStyleBible(editBible?.styleBibleJson)
}

export async function resolveEditScriptStyleBibleSignatureForTask(input: {
  readonly projectId: string
  readonly episodeId?: string | null
}): Promise<string> {
  const styleBible = await resolveEditScriptStyleBibleForTask(input)
  if (!styleBible) return 'style-bible:none'
  const digest = createHash('sha1').update(JSON.stringify(styleBible)).digest('hex').slice(0, 16)
  return `style-bible:${digest}`
}

export function renderStyleBiblePromptBlock(input: {
  readonly styleBible: EditScriptStyleBible
  readonly usage: StyleBiblePromptUsage
  readonly locale: Locale
}): string {
  const { styleBible, usage, locale } = input
  const title = locale === 'en'
    ? 'System visual style requirements, must follow:'
    : '系统画面风格要求（必须遵守）：'
  const visual = locale === 'en'
    ? `Visual style: ${styleBible.visualStyle}`
    : `画面风格：${styleBible.visualStyle}`
  if (usage === 'video') return [title, visual].join('\n')
  const asset = styleBible.assetImageStyle
  return [
    title,
    visual,
    locale === 'en' ? `Asset lighting: ${asset.lighting}` : `资产图光线：${asset.lighting}`,
    locale === 'en' ? `Asset texture: ${asset.texture}` : `资产图材质：${asset.texture}`,
    locale === 'en' ? `Asset composition: ${asset.composition}` : `资产图构图：${asset.composition}`,
  ].join('\n')
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
