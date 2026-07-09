export interface StructuredStreamParseState {
  readonly mode: 'array' | 'object'
  readonly path: readonly string[]
  readonly text: string
  readonly cursor: number | null
  readonly arrayStart: number | null
  readonly complete: boolean
}

export interface StructuredStreamParseResult {
  readonly state: StructuredStreamParseState
  readonly items: readonly unknown[]
}

interface JsonStringReadResult {
  readonly value: string
  readonly endIndex: number
}

export function createStructuredStreamParseState(path: readonly string[]): StructuredStreamParseState {
  if (path.length === 0) {
    throw new Error('STRUCTURED_STREAM_PATH_REQUIRED')
  }
  return {
    mode: 'array',
    path,
    text: '',
    cursor: null,
    arrayStart: null,
    complete: false,
  }
}

export function createStructuredStreamObjectParseState(path: readonly string[]): StructuredStreamParseState {
  return {
    mode: 'object',
    path,
    text: '',
    cursor: null,
    arrayStart: null,
    complete: false,
  }
}

export function appendStructuredJsonChunk(
  state: StructuredStreamParseState,
  chunk: string,
): StructuredStreamParseResult {
  if (state.mode === 'object') return appendStructuredJsonObjectChunk(state, chunk)
  if (state.complete) {
    return {
      state: {
        ...state,
        text: state.text + chunk,
      },
      items: [],
    }
  }

  const text = state.text + chunk
  const arrayStart = state.arrayStart ?? findArrayStartForPath(text, state.path)
  if (arrayStart === null) {
    return {
      state: {
        ...state,
        text,
      },
      items: [],
    }
  }

  const items: unknown[] = []
  let cursor = state.cursor ?? arrayStart + 1
  let complete = false

  while (cursor < text.length) {
    cursor = skipWhitespaceAndCommas(text, cursor)
    if (cursor >= text.length) break

    const current = text[cursor]
    if (current === ']') {
      cursor += 1
      complete = true
      break
    }

    const valueEnd = findCompleteJsonValueEnd(text, cursor)
    if (valueEnd === null) break

    const segment = text.slice(cursor, valueEnd)
    try {
      items.push(JSON.parse(segment) as unknown)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`STRUCTURED_STREAM_JSON_ITEM_INVALID:${message}`)
    }
    cursor = valueEnd
  }

  return {
    state: {
      mode: state.mode,
      path: state.path,
      text,
      cursor,
      arrayStart,
      complete,
    },
    items,
  }
}

function appendStructuredJsonObjectChunk(
  state: StructuredStreamParseState,
  chunk: string,
): StructuredStreamParseResult {
  if (state.complete) {
    return {
      state: {
        ...state,
        text: state.text + chunk,
      },
      items: [],
    }
  }

  const text = state.text + chunk
  const valueStart = state.arrayStart ?? findValueStartForPath(text, state.path)
  if (valueStart === null) {
    return {
      state: {
        ...state,
        text,
      },
      items: [],
    }
  }

  const valueEnd = findCompleteJsonValueEnd(text, valueStart)
  if (valueEnd === null) {
    return {
      state: {
        ...state,
        text,
        arrayStart: valueStart,
        cursor: valueStart,
      },
      items: [],
    }
  }

  const segment = text.slice(valueStart, valueEnd)
  try {
    return {
      state: {
        mode: state.mode,
        path: state.path,
        text,
        cursor: valueEnd,
        arrayStart: valueStart,
        complete: true,
      },
      items: [JSON.parse(segment) as unknown],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`STRUCTURED_STREAM_JSON_ITEM_INVALID:${message}`)
  }
}

function findArrayStartForPath(text: string, path: readonly string[]): number | null {
  const valueStart = findValueStartForPath(text, path)
  if (valueStart === null) return null
  return text[valueStart] === '[' ? valueStart : null
}

function findValueStartForPath(text: string, path: readonly string[]): number | null {
  if (path.length === 0) return nextNonWhitespaceIndex(text, 0)
  let searchFrom = 0
  for (let index = 0; index < path.length; index += 1) {
    const property = findJsonProperty(text, path[index] ?? '', searchFrom)
    if (!property) return null
    const colonIndex = nextNonWhitespaceIndex(text, property.endIndex)
    if (colonIndex === null || text[colonIndex] !== ':') return null
    const valueIndex = nextNonWhitespaceIndex(text, colonIndex + 1)
    if (valueIndex === null) return null
    if (index === path.length - 1) {
      return valueIndex
    }
    searchFrom = valueIndex
  }
  return null
}

function findJsonProperty(
  text: string,
  propertyName: string,
  fromIndex: number,
): JsonStringReadResult | null {
  let index = fromIndex
  while (index < text.length) {
    if (text[index] !== '"') {
      index += 1
      continue
    }
    const stringResult = readJsonString(text, index)
    if (!stringResult) return null
    const colonIndex = nextNonWhitespaceIndex(text, stringResult.endIndex)
    if (stringResult.value === propertyName && colonIndex !== null && text[colonIndex] === ':') {
      return stringResult
    }
    index = stringResult.endIndex
  }
  return null
}

function readJsonString(text: string, quoteIndex: number): JsonStringReadResult | null {
  let index = quoteIndex + 1
  let escaped = false
  while (index < text.length) {
    const char = text[index]
    if (escaped) {
      escaped = false
      index += 1
      continue
    }
    if (char === '\\') {
      escaped = true
      index += 1
      continue
    }
    if (char === '"') {
      const raw = text.slice(quoteIndex, index + 1)
      try {
        return {
          value: JSON.parse(raw) as string,
          endIndex: index + 1,
        }
      } catch {
        return null
      }
    }
    index += 1
  }
  return null
}

function skipWhitespaceAndCommas(text: string, fromIndex: number): number {
  let index = fromIndex
  while (index < text.length) {
    const char = text[index]
    if (char === ',' || char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      index += 1
      continue
    }
    break
  }
  return index
}

function nextNonWhitespaceIndex(text: string, fromIndex: number): number | null {
  let index = fromIndex
  while (index < text.length) {
    const char = text[index]
    if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') return index
    index += 1
  }
  return null
}

function findCompleteJsonValueEnd(text: string, valueStart: number): number | null {
  const first = text[valueStart]
  if (first === '{' || first === '[') return findBalancedJsonEnd(text, valueStart)
  if (first === '"') {
    const stringResult = readJsonString(text, valueStart)
    return stringResult?.endIndex ?? null
  }
  return findPrimitiveJsonEnd(text, valueStart)
}

function findBalancedJsonEnd(text: string, valueStart: number): number | null {
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let index = valueStart; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      stack.push('}')
      continue
    }
    if (char === '[') {
      stack.push(']')
      continue
    }
    if (char === '}' || char === ']') {
      const expected = stack.pop()
      if (expected !== char) {
        throw new Error('STRUCTURED_STREAM_JSON_ITEM_INVALID:UNBALANCED_JSON')
      }
      if (stack.length === 0) return index + 1
    }
  }
  return null
}

function findPrimitiveJsonEnd(text: string, valueStart: number): number | null {
  let index = valueStart
  while (index < text.length) {
    const char = text[index]
    if (char === ',' || char === ']') {
      const value = text.slice(valueStart, index).trim()
      return value ? index : null
    }
    index += 1
  }
  return null
}
