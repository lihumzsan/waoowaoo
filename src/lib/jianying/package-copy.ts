import zh from '../../../messages/zh/project-workflow.json'
import en from '../../../messages/en/project-workflow.json'
import type { Locale } from '@/i18n/routing'

const messages = { zh, en } satisfies Record<Locale, typeof zh>
export function jianyingPackageReadme(locale: Locale): string {
  return Object.values(
    messages[locale].canvas.workspace.archive.exportReadme,
  ).join('\n')
}
