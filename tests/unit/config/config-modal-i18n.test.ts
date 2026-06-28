import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REQUIRED_CONFIG_MODAL_KEYS = [
  'musicModel',
  'noModelOptions',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readMessages(locale: 'zh' | 'en'): Record<string, unknown> {
  const filePath = path.resolve(process.cwd(), 'messages', locale, 'configModal.json')
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`CONFIG_MODAL_MESSAGES_INVALID:${locale}`)
  return parsed
}

describe('config modal i18n', () => {
  it('defines every project config model selector label and empty state copy', () => {
    for (const locale of ['zh', 'en'] as const) {
      const messages = readMessages(locale)

      for (const key of REQUIRED_CONFIG_MODAL_KEYS) {
        expect(typeof messages[key]).toBe('string')
        expect(String(messages[key]).trim().length).toBeGreaterThan(0)
      }
    }
  })
})
