import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { locales, type Locale } from '@/i18n/routing'

export const OFFICIAL_CONTENT_DIR_ENV = 'OFFICIAL_CONTENT_DIR'

export interface OfficialTextSection { title: string; body: string }
export interface OfficialLegalPageContent {
  eyebrow: string
  title: string
  description: string
  updatedAt: string
  sections: readonly OfficialTextSection[]
}
export interface OfficialContactField { label: string; value: string }
export interface OfficialPortalOnlyContent { title: string; description: string; items: readonly string[] }
export interface OfficialContactPageContent {
  eyebrow: string
  title: string
  description: string
  publicInfo: { title: string; fields: readonly OfficialContactField[] }
  portalOnly: OfficialPortalOnlyContent
}
export type OfficialLegalPageKey = 'terms' | 'privacy' | 'refund-policy'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function required(record: Record<string, unknown>, key: string, schema: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`OFFICIAL_CONTENT_INVALID:${schema}:${key}`)
  return value
}
function readContentDir(): string {
  const configured = process.env[OFFICIAL_CONTENT_DIR_ENV]?.trim()
  if (!configured) throw new Error(`${OFFICIAL_CONTENT_DIR_ENV}_REQUIRED_FOR_CLOUD_PUBLIC_PAGES`)
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}
function readJsonRecord(fileName: string): Record<string, unknown> {
  const filePath = path.join(readContentDir(), fileName)
  if (!existsSync(filePath)) throw new Error(`OFFICIAL_CONTENT_FILE_MISSING:${filePath}`)
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`OFFICIAL_CONTENT_FILE_INVALID:${filePath}`)
  return parsed
}
export function normalizeOfficialLocale(value: string): Locale {
  if ((locales as readonly string[]).includes(value)) return value as Locale
  throw new Error(`OFFICIAL_CONTENT_LOCALE_INVALID:${value}`)
}
export function readOfficialLegalPage(page: OfficialLegalPageKey, locale: Locale): OfficialLegalPageContent {
  const schema = `${page}.${locale}.json`
  const record = readJsonRecord(schema)
  const sections = record.sections
  if (!Array.isArray(sections)) throw new Error(`OFFICIAL_CONTENT_INVALID:${schema}:sections`)
  return {
    eyebrow: required(record, 'eyebrow', schema),
    title: required(record, 'title', schema),
    description: required(record, 'description', schema),
    updatedAt: required(record, 'updatedAt', schema),
    sections: sections.map((value, index) => {
      if (!isRecord(value)) throw new Error(`OFFICIAL_CONTENT_INVALID:${schema}:sections[${index}]`)
      return { title: required(value, 'title', schema), body: required(value, 'body', schema) }
    }),
  }
}

export function readOfficialContactPage(locale: Locale): OfficialContactPageContent {
  const schema = `contact.${locale}.json`
  const record = readJsonRecord(schema)
  const publicInfo = record.publicInfo
  const portalOnly = record.portalOnly
  if (!isRecord(publicInfo) || !isRecord(portalOnly) || !Array.isArray(publicInfo.fields) || !Array.isArray(portalOnly.items)) {
    throw new Error(`OFFICIAL_CONTENT_INVALID:${schema}`)
  }
  return {
    eyebrow: required(record, 'eyebrow', schema),
    title: required(record, 'title', schema),
    description: required(record, 'description', schema),
    publicInfo: {
      title: required(publicInfo, 'title', `${schema}.publicInfo`),
      fields: publicInfo.fields.map((value, index) => {
        if (!isRecord(value)) throw new Error(`OFFICIAL_CONTENT_INVALID:${schema}:fields[${index}]`)
        return { label: required(value, 'label', schema), value: required(value, 'value', schema) }
      }),
    },
    portalOnly: {
      title: required(portalOnly, 'title', `${schema}.portalOnly`),
      description: required(portalOnly, 'description', `${schema}.portalOnly`),
      items: portalOnly.items.map((value, index) => {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`OFFICIAL_CONTENT_INVALID:${schema}:items[${index}]`)
        return value
      }),
    },
  }
}
