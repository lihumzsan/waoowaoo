import type { EditSourceRange } from './schemas'

export function assertEditSourceRange(text: string, range: EditSourceRange): EditSourceRange {
  if (range.sourceStart < 0 || range.sourceEnd > text.length || range.sourceEnd <= range.sourceStart) {
    throw new Error(
      `EDIT_SOURCE_RANGE_INVALID:start=${String(range.sourceStart)}:end=${String(range.sourceEnd)}:length=${String(text.length)}`,
    )
  }
  return range
}

export function sliceEditSourceText(text: string, range: EditSourceRange): string {
  assertEditSourceRange(text, range)
  return text.slice(range.sourceStart, range.sourceEnd)
}

export function assertOrderedNonOverlappingSourceRanges(
  text: string,
  ranges: readonly EditSourceRange[],
): readonly EditSourceRange[] {
  let previousEnd = 0
  for (const range of ranges) {
    assertEditSourceRange(text, range)
    if (range.sourceStart < previousEnd) {
      throw new Error(
        `EDIT_SOURCE_RANGE_OVERLAP:start=${String(range.sourceStart)}:previousEnd=${String(previousEnd)}`,
      )
    }
    previousEnd = range.sourceEnd
  }
  return ranges
}
