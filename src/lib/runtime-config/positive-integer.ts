export function resolvePositiveIntegerConfig(input: {
  readonly name: string
  readonly value: string | undefined
  readonly defaultValue: number
  readonly minValue?: number
  readonly maxValue?: number
}): number {
  if (input.value === undefined) return input.defaultValue
  const normalized = input.value.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`POSITIVE_INTEGER_CONFIG_INVALID:${input.name}:${input.value}`)
  }
  const parsed = Number(normalized)
  if (
    !Number.isSafeInteger(parsed)
    || (input.minValue !== undefined && parsed < input.minValue)
    || (input.maxValue !== undefined && parsed > input.maxValue)
  ) {
    throw new Error(`POSITIVE_INTEGER_CONFIG_INVALID:${input.name}:${input.value}`)
  }
  return parsed
}
