import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { locales, type Locale } from '@/i18n/routing'

export const OFFICIAL_CONTENT_DIR_ENV = 'OFFICIAL_CONTENT_DIR'

export interface OfficialTextSection {
  title: string
  body: string
}

export interface OfficialLegalPageContent {
  eyebrow: string
  title: string
  description: string
  updatedAt: string
  sections: readonly OfficialTextSection[]
}

export interface OfficialPricingPlan {
  label: string
  name: string
  price: string
  unit: string
  creditsAmount: number
  tagline: string
  status: string
  details: readonly string[]
}

export interface OfficialPricingFaq {
  question: string
  answer: string
}

export interface OfficialPricingCompareRow {
  label: string
  values: readonly string[]
}

export interface OfficialPricingPageContent {
  brand: string
  eyebrow: string
  title: string
  description: string
  betaNotice: string
  paymentNote: string
  plans: readonly OfficialPricingPlan[]
  compareRows: readonly OfficialPricingCompareRow[]
  faqs: readonly OfficialPricingFaq[]
  creditPolicy: OfficialTextSection
  checkout: {
    title: string
    body: string
    primaryCta: string
    secondaryCta: string
  }
}

export interface OfficialContactField {
  label: string
  value: string
}

export interface OfficialPortalOnlyContent {
  title: string
  description: string
  items: readonly string[]
}

export interface OfficialContactPageContent {
  eyebrow: string
  title: string
  description: string
  publicInfo: {
    title: string
    fields: readonly OfficialContactField[]
  }
  portalOnly: OfficialPortalOnlyContent
}

export type OfficialLegalPageKey = 'terms' | 'privacy' | 'refund-policy'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(schema: string, message: string): never {
  throw new Error(`OFFICIAL_CONTENT_INVALID: ${schema}: ${message}`)
}

function readRequiredString(record: Record<string, unknown>, key: string, schema: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(schema, `${key} must be a non-empty string`)
  }
  return value
}

function readRequiredPositiveNumber(record: Record<string, unknown>, key: string, schema: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(schema, `${key} must be a positive number`)
  }
  return value
}

function readRequiredRecord(record: Record<string, unknown>, key: string, schema: string): Record<string, unknown> {
  const value = record[key]
  if (!isRecord(value)) fail(schema, `${key} must be an object`)
  return value
}

function readStringArray(record: Record<string, unknown>, key: string, schema: string): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value)) fail(schema, `${key} must be an array`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      fail(schema, `${key}[${index}] must be a non-empty string`)
    }
    return item
  })
}

function readSection(record: Record<string, unknown>, schema: string): OfficialTextSection {
  return {
    title: readRequiredString(record, 'title', schema),
    body: readRequiredString(record, 'body', schema),
  }
}

function readSectionArray(record: Record<string, unknown>, key: string, schema: string): readonly OfficialTextSection[] {
  const value = record[key]
  if (!Array.isArray(value)) fail(schema, `${key} must be an array`)
  return value.map((item, index) => {
    if (!isRecord(item)) fail(schema, `${key}[${index}] must be an object`)
    return readSection(item, `${schema}.${key}[${index}]`)
  })
}

function readFaqArray(record: Record<string, unknown>, key: string, schema: string): readonly OfficialPricingFaq[] {
  const value = record[key]
  if (!Array.isArray(value)) fail(schema, `${key} must be an array`)
  return value.map((item, index) => {
    if (!isRecord(item)) fail(schema, `${key}[${index}] must be an object`)
    return {
      question: readRequiredString(item, 'question', `${schema}.${key}[${index}]`),
      answer: readRequiredString(item, 'answer', `${schema}.${key}[${index}]`),
    }
  })
}

function readCompareRows(record: Record<string, unknown>, key: string, schema: string): readonly OfficialPricingCompareRow[] {
  const value = record[key]
  if (!Array.isArray(value)) fail(schema, `${key} must be an array`)
  return value.map((item, index) => {
    if (!isRecord(item)) fail(schema, `${key}[${index}] must be an object`)
    return {
      label: readRequiredString(item, 'label', `${schema}.${key}[${index}]`),
      values: readStringArray(item, 'values', `${schema}.${key}[${index}]`),
    }
  })
}

function readContentDir(): string {
  const configured = process.env[OFFICIAL_CONTENT_DIR_ENV]?.trim()
  if (!configured) {
    throw new Error(`${OFFICIAL_CONTENT_DIR_ENV}_REQUIRED_FOR_CLOUD_PUBLIC_PAGES`)
  }
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}

function readJsonRecord(fileName: string): Record<string, unknown> {
  const filePath = path.join(readContentDir(), fileName)
  if (!existsSync(filePath)) {
    throw new Error(`OFFICIAL_CONTENT_FILE_MISSING: ${filePath}`)
  }

  const raw = readFileSync(filePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) {
    throw new Error(`OFFICIAL_CONTENT_FILE_INVALID: ${filePath} must contain a JSON object`)
  }
  return parsed
}

function pageFileName(page: string, locale: Locale): string {
  return `${page}.${locale}.json`
}

export function normalizeOfficialLocale(value: string): Locale {
  if ((locales as readonly string[]).includes(value)) return value as Locale
  throw new Error(`OFFICIAL_CONTENT_LOCALE_INVALID: ${value}`)
}

export function readOfficialLegalPage(page: OfficialLegalPageKey, locale: Locale): OfficialLegalPageContent {
  const schema = pageFileName(page, locale)
  const record = readJsonRecord(schema)
  return {
    eyebrow: readRequiredString(record, 'eyebrow', schema),
    title: readRequiredString(record, 'title', schema),
    description: readRequiredString(record, 'description', schema),
    updatedAt: readRequiredString(record, 'updatedAt', schema),
    sections: readSectionArray(record, 'sections', schema),
  }
}

export function readOfficialPricingPage(locale: Locale): OfficialPricingPageContent {
  const schema = pageFileName('pricing', locale)
  const record = readJsonRecord(schema)
  const plans = readRequiredRecord(record, 'plans', schema)
  const checkout = readRequiredRecord(record, 'checkout', schema)
  const planItems = Object.entries(plans).map(([planKey, planValue]) => {
    if (!isRecord(planValue)) fail(schema, `plans.${planKey} must be an object`)
    return {
      label: readRequiredString(planValue, 'label', `${schema}.plans.${planKey}`),
      name: readRequiredString(planValue, 'name', `${schema}.plans.${planKey}`),
      price: readRequiredString(planValue, 'price', `${schema}.plans.${planKey}`),
      unit: readRequiredString(planValue, 'unit', `${schema}.plans.${planKey}`),
      creditsAmount: readRequiredPositiveNumber(planValue, 'creditsAmount', `${schema}.plans.${planKey}`),
      tagline: readRequiredString(planValue, 'tagline', `${schema}.plans.${planKey}`),
      status: readRequiredString(planValue, 'status', `${schema}.plans.${planKey}`),
      details: readStringArray(planValue, 'details', `${schema}.plans.${planKey}`),
    }
  })

  if (planItems.length === 0) fail(schema, 'plans must contain at least one plan')

  return {
    brand: readRequiredString(record, 'brand', schema),
    eyebrow: readRequiredString(record, 'eyebrow', schema),
    title: readRequiredString(record, 'title', schema),
    description: readRequiredString(record, 'description', schema),
    betaNotice: readRequiredString(record, 'betaNotice', schema),
    paymentNote: readRequiredString(record, 'paymentNote', schema),
    plans: planItems,
    compareRows: readCompareRows(record, 'compareRows', schema),
    faqs: readFaqArray(record, 'faqs', schema),
    creditPolicy: readSection(readRequiredRecord(record, 'creditPolicy', schema), `${schema}.creditPolicy`),
    checkout: {
      title: readRequiredString(checkout, 'title', `${schema}.checkout`),
      body: readRequiredString(checkout, 'body', `${schema}.checkout`),
      primaryCta: readRequiredString(checkout, 'primaryCta', `${schema}.checkout`),
      secondaryCta: readRequiredString(checkout, 'secondaryCta', `${schema}.checkout`),
    },
  }
}

export function readOfficialContactPage(locale: Locale): OfficialContactPageContent {
  const schema = pageFileName('contact', locale)
  const record = readJsonRecord(schema)
  const publicInfo = readRequiredRecord(record, 'publicInfo', schema)
  const fields = publicInfo.fields
  if (!Array.isArray(fields)) fail(`${schema}.publicInfo`, 'fields must be an array')
  const portalOnly = readRequiredRecord(record, 'portalOnly', schema)

  return {
    eyebrow: readRequiredString(record, 'eyebrow', schema),
    title: readRequiredString(record, 'title', schema),
    description: readRequiredString(record, 'description', schema),
    publicInfo: {
      title: readRequiredString(publicInfo, 'title', `${schema}.publicInfo`),
      fields: fields.map((item, index) => {
        if (!isRecord(item)) fail(`${schema}.publicInfo`, `fields[${index}] must be an object`)
        return {
          label: readRequiredString(item, 'label', `${schema}.publicInfo.fields[${index}]`),
          value: readRequiredString(item, 'value', `${schema}.publicInfo.fields[${index}]`),
        }
      }),
    },
    portalOnly: {
      title: readRequiredString(portalOnly, 'title', `${schema}.portalOnly`),
      description: readRequiredString(portalOnly, 'description', `${schema}.portalOnly`),
      items: readStringArray(portalOnly, 'items', `${schema}.portalOnly`),
    },
  }
}
