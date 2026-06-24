import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TRANSACTIONS_TITLE_MARKER = "{t('accountTransactions')}"
const SECTION_CLASS_PREFIX = '<section className="'

function readAccountTransactionsSectionClasses(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/app/[locale]/profile/page.tsx'), 'utf8')
  const titleIndex = source.indexOf(TRANSACTIONS_TITLE_MARKER)

  if (titleIndex < 0) {
    throw new Error('ACCOUNT_TRANSACTIONS_TITLE_NOT_FOUND')
  }

  const precedingSource = source.slice(0, titleIndex)
  const sectionIndex = precedingSource.lastIndexOf(SECTION_CLASS_PREFIX)

  if (sectionIndex < 0) {
    throw new Error('ACCOUNT_TRANSACTIONS_SECTION_NOT_FOUND')
  }

  const classStartIndex = sectionIndex + SECTION_CLASS_PREFIX.length
  const classEndIndex = source.indexOf('"', classStartIndex)

  if (classEndIndex < 0) {
    throw new Error('ACCOUNT_TRANSACTIONS_SECTION_CLASS_NOT_CLOSED')
  }

  return source.slice(classStartIndex, classEndIndex).split(/\s+/)
}

describe('profile billing layout', () => {
  it('keeps account transaction rows inside a content-height card', () => {
    const classes = readAccountTransactionsSectionClasses()

    expect(classes).toContain('flex-none')
    expect(classes).not.toContain('flex-1')
    expect(classes).not.toContain('min-h-0')
  })
})
