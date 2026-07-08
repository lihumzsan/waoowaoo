import { z } from 'zod'
import { assertEditSourceRange } from './offsets'
import type { EditSourceRange } from './schemas'

const DEFAULT_BLOCK_TARGET_CHARS = 700
const DEFAULT_BLOCK_MIN_CHARS = 120
const BLOCK_BOUNDARY_PATTERN = /[。！？!?；;\n]/

export const editSourceAnchorSchema = z.object({
  startBlockId: z.string().trim().min(1),
  startQuote: z.string().trim().min(1),
  endBlockId: z.string().trim().min(1),
  endQuote: z.string().trim().min(1),
})

export type EditSourceAnchor = z.infer<typeof editSourceAnchorSchema>

export const editSourcePointAnchorSchema = z.object({
  blockId: z.string().trim().min(1),
  quote: z.string().trim().min(1),
})

export type EditSourcePointAnchor = z.infer<typeof editSourcePointAnchorSchema>

export interface EditSourceBlock {
  readonly blockId: string
  readonly sourceStart: number
  readonly sourceEnd: number
  readonly text: string
}

interface BlockBuildOptions {
  readonly targetChars?: number
  readonly minChars?: number
}

function formatBlockId(index: number): string {
  return `p${String(index + 1).padStart(4, '0')}`
}

function createTrimmedBlock(input: {
  readonly blockId: string
  readonly sourceText: string
  readonly sourceStart: number
  readonly sourceEnd: number
}): EditSourceBlock | null {
  let sourceStart = input.sourceStart
  let sourceEnd = input.sourceEnd
  while (sourceStart < sourceEnd && /\s/.test(input.sourceText[sourceStart] ?? '')) sourceStart += 1
  while (sourceEnd > sourceStart && /\s/.test(input.sourceText[sourceEnd - 1] ?? '')) sourceEnd -= 1
  if (sourceEnd <= sourceStart) return null
  return {
    blockId: input.blockId,
    sourceStart,
    sourceEnd,
    text: input.sourceText.slice(sourceStart, sourceEnd),
  }
}

export function buildEditSourceBlocks(
  sourceText: string,
  options: BlockBuildOptions = {},
): readonly EditSourceBlock[] {
  const targetChars = options.targetChars ?? DEFAULT_BLOCK_TARGET_CHARS
  const minChars = options.minChars ?? DEFAULT_BLOCK_MIN_CHARS
  const blocks: EditSourceBlock[] = []
  let blockStart = 0
  let blockIndex = 0

  for (let index = 0; index < sourceText.length; index += 1) {
    const char = sourceText[index] ?? ''
    const length = index + 1 - blockStart
    const shouldCutAtBoundary = length >= minChars && BLOCK_BOUNDARY_PATTERN.test(char)
    const shouldForceCut = length >= targetChars
    if (!shouldCutAtBoundary && !shouldForceCut) continue
    const block = createTrimmedBlock({
      blockId: formatBlockId(blockIndex),
      sourceText,
      sourceStart: blockStart,
      sourceEnd: index + 1,
    })
    if (block) {
      blocks.push(block)
      blockIndex += 1
    }
    blockStart = index + 1
  }

  const tail = createTrimmedBlock({
    blockId: formatBlockId(blockIndex),
    sourceText,
    sourceStart: blockStart,
    sourceEnd: sourceText.length,
  })
  if (tail) blocks.push(tail)
  if (blocks.length === 0) {
    throw new Error('EDIT_SOURCE_BLOCKS_EMPTY')
  }
  return blocks
}

export function formatEditSourceBlocksForPrompt(blocks: readonly EditSourceBlock[]): string {
  return blocks.map((block) => `[${block.blockId}]\n${block.text}`).join('\n\n')
}

function blockMap(blocks: readonly EditSourceBlock[]): ReadonlyMap<string, EditSourceBlock> {
  return new Map(blocks.map((block) => [block.blockId, block]))
}

function requireBlock(input: {
  readonly blocksById: ReadonlyMap<string, EditSourceBlock>
  readonly blockId: string
}): EditSourceBlock {
  const block = input.blocksById.get(input.blockId)
  if (!block) {
    throw new Error(`EDIT_SOURCE_ANCHOR_BLOCK_NOT_FOUND:${input.blockId}`)
  }
  return block
}

function locateUniqueQuote(input: {
  readonly block: EditSourceBlock
  readonly quote: string
  readonly field: 'startQuote' | 'endQuote' | 'quote'
}): number {
  const quote = input.quote.trim()
  const first = input.block.text.indexOf(quote)
  if (first < 0) {
    throw new Error(`EDIT_SOURCE_ANCHOR_QUOTE_NOT_FOUND:${input.block.blockId}:${input.field}:${quote}`)
  }
  const second = input.block.text.indexOf(quote, first + quote.length)
  if (second >= 0) {
    throw new Error(`EDIT_SOURCE_ANCHOR_QUOTE_AMBIGUOUS:${input.block.blockId}:${input.field}:${quote}`)
  }
  return input.block.sourceStart + first
}

export function resolveEditSourceAnchor(input: {
  readonly sourceText: string
  readonly blocks: readonly EditSourceBlock[]
  readonly anchor: EditSourceAnchor
}): EditSourceRange {
  const blocksById = blockMap(input.blocks)
  const startBlock = requireBlock({ blocksById, blockId: input.anchor.startBlockId })
  const endBlock = requireBlock({ blocksById, blockId: input.anchor.endBlockId })
  const sourceStart = locateUniqueQuote({
    block: startBlock,
    quote: input.anchor.startQuote,
    field: 'startQuote',
  })
  const endQuoteStart = locateUniqueQuote({
    block: endBlock,
    quote: input.anchor.endQuote,
    field: 'endQuote',
  })
  const sourceEnd = endQuoteStart + input.anchor.endQuote.trim().length
  return assertEditSourceRange(input.sourceText, { sourceStart, sourceEnd })
}

export function resolveEditSourcePointAnchor(input: {
  readonly sourceText: string
  readonly blocks: readonly EditSourceBlock[]
  readonly anchor: EditSourcePointAnchor
}): number {
  const blocksById = blockMap(input.blocks)
  const block = requireBlock({ blocksById, blockId: input.anchor.blockId })
  const sourceStart = locateUniqueQuote({
    block,
    quote: input.anchor.quote,
    field: 'quote',
  })
  assertEditSourceRange(input.sourceText, {
    sourceStart,
    sourceEnd: sourceStart + input.anchor.quote.trim().length,
  })
  return sourceStart
}
