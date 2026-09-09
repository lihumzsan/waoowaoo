import type { ComfyUiPromptGraph } from './profiles'
import { asComfyUiRecord } from './transport'

type ComfyUiInputDefinition = readonly unknown[]

type ComfyUiDynamicComboOption = {
  readonly key: string
  readonly required: Record<string, unknown>
  readonly optional: Record<string, unknown> | null
}

function readDynamicComboOptions(definition: ComfyUiInputDefinition): readonly ComfyUiDynamicComboOption[] {
  const metadata = asComfyUiRecord(definition[1])
  if (!Array.isArray(metadata?.options) || metadata.options.length === 0) {
    throw new Error('COMFYUI_DYNAMIC_COMBO_SCHEMA_INVALID')
  }
  const keys = new Set<string>()
  return metadata.options.map((candidate: unknown) => {
    const option = asComfyUiRecord(candidate)
    const inputs = asComfyUiRecord(option?.inputs)
    const required = asComfyUiRecord(inputs?.required)
    const optional = asComfyUiRecord(inputs?.optional)
    if (typeof option?.key !== 'string' || !option.key || keys.has(option.key) || !required
      || (inputs?.optional !== undefined && !optional)) {
      throw new Error('COMFYUI_DYNAMIC_COMBO_SCHEMA_INVALID')
    }
    keys.add(option.key)
    return { key: option.key, required, optional }
  })
}

function expandDynamicComboInputs(input: {
  readonly required: Record<string, unknown> | null
  readonly optional: Record<string, unknown> | null
  readonly graphInputs: Readonly<Record<string, unknown>>
}): { required: Record<string, unknown>; optional: Record<string, unknown> } {
  const required = { ...input.required }
  const optional = { ...input.optional }
  for (const [selectorName, definition] of Object.entries({ ...required, ...optional })) {
    if (!Array.isArray(definition) || definition[0] !== 'COMFY_DYNAMICCOMBO_V3') continue
    const selected = readDynamicComboOptions(definition).find((option) => option.key === input.graphInputs[selectorName])
    if (!selected) continue // A supplied invalid selector is rejected by scalar validation.
    for (const [name, dependent] of Object.entries(selected.required)) required[`${selectorName}.${name}`] = dependent
    for (const [name, dependent] of Object.entries(selected.optional ?? {})) optional[`${selectorName}.${name}`] = dependent
  }
  return { required, optional }
}

export type ComfyUiGraphOptionMismatch = Readonly<{
  className: string
  inputName: string
  value: string
}>

type ResolvedInputDefinition = Readonly<{
  definition: ComfyUiInputDefinition
  location: 'required' | 'optional' | 'dependent' | 'autogrow'
}>

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function readNodeInfo(info: unknown, className: string): Record<string, unknown> {
  const node = asComfyUiRecord(asComfyUiRecord(info)?.[className])
  if (!node) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
  return node
}

function readDefinition(
  schema: Record<string, unknown> | null,
  inputName: string,
): ComfyUiInputDefinition | null {
  const definition = schema?.[inputName]
  return Array.isArray(definition) && definition.length > 0 ? definition : null
}

function readDependentDefinition(input: {
  readonly required: Record<string, unknown> | null
  readonly graphInputs: Readonly<Record<string, unknown>>
  readonly inputName: string
}): ComfyUiInputDefinition | null {
  for (const [selectorName, candidate] of Object.entries(input.required ?? {})) {
    if (!Array.isArray(candidate)) continue
    const metadata = asComfyUiRecord(candidate[1])
    const definitionsBySelector = asComfyUiRecord(metadata?.formats)
    const selectorValue = input.graphInputs[selectorName]
    if (!definitionsBySelector || typeof selectorValue !== 'string') continue
    const dependentDefinitions = definitionsBySelector[selectorValue]
    if (!Array.isArray(dependentDefinitions)) continue
    for (const dependentDefinition of dependentDefinitions) {
      if (
        Array.isArray(dependentDefinition)
        && dependentDefinition[0] === input.inputName
        && dependentDefinition.length >= 2
      ) {
        return dependentDefinition.slice(1)
      }
    }
  }
  return null
}

function readAutogrowDefinition(input: {
  readonly optional: Record<string, unknown> | null
  readonly inputName: string
}): ComfyUiInputDefinition | null {
  const separatorIndex = input.inputName.indexOf('.')
  if (separatorIndex <= 0) return null
  const groupName = input.inputName.slice(0, separatorIndex)
  const memberName = input.inputName.slice(separatorIndex + 1)
  const groupDefinition = readDefinition(input.optional, groupName)
  if (!groupDefinition || groupDefinition[0] !== 'COMFY_AUTOGROW_V3') return null
  const metadata = asComfyUiRecord(groupDefinition[1])
  const template = asComfyUiRecord(metadata?.template)
  const prefix = typeof template?.prefix === 'string' ? template.prefix : ''
  if (!prefix || !memberName.startsWith(prefix)) return null
  const indexText = memberName.slice(prefix.length)
  if (!/^\d+$/u.test(indexText)) return null
  const memberIndex = Number.parseInt(indexText, 10)
  const maximum = template?.max
  if (
    !Number.isSafeInteger(memberIndex)
    || memberIndex < 0
    || (typeof maximum === 'number' && memberIndex >= maximum)
  ) {
    return null
  }
  const templateInput = asComfyUiRecord(template?.input)
  const templateRequired = asComfyUiRecord(templateInput?.required)
  if (!templateRequired) return null
  const memberDefinitions = Object.values(templateRequired).filter(
    (candidate): candidate is unknown[] => Array.isArray(candidate) && candidate.length > 0,
  )
  return memberDefinitions.length === 1 ? memberDefinitions[0]! : null
}

function resolveInputDefinition(input: {
  readonly required: Record<string, unknown> | null
  readonly optional: Record<string, unknown> | null
  readonly graphInputs: Readonly<Record<string, unknown>>
  readonly inputName: string
}): ResolvedInputDefinition | null {
  const required = readDefinition(input.required, input.inputName)
  if (required) return { definition: required, location: 'required' }
  const optional = readDefinition(input.optional, input.inputName)
  if (optional) return { definition: optional, location: 'optional' }
  const dependent = readDependentDefinition(input)
  if (dependent) return { definition: dependent, location: 'dependent' }
  const autogrow = readAutogrowDefinition(input)
  return autogrow ? { definition: autogrow, location: 'autogrow' } : null
}

function isGraphLink(
  value: unknown,
): value is readonly [string, number] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'string'
    && Number.isSafeInteger(value[1])
    && value[1] >= 0
}

function readInputType(definition: ComfyUiInputDefinition): string | null {
  if (Array.isArray(definition[0]) || definition[0] === 'COMFY_DYNAMICCOMBO_V3') return 'COMBO'
  return typeof definition[0] === 'string' ? definition[0] : null
}

function assertScalarInput(input: {
  readonly className: string
  readonly inputName: string
  readonly value: unknown
  readonly definition: ComfyUiInputDefinition
  readonly createOptionMismatchError: (input: ComfyUiGraphOptionMismatch) => Error
}): void {
  const [typeOrOptions, rawMetadata] = input.definition
  const metadata = asComfyUiRecord(rawMetadata)
  const uploadInput = metadata?.image_upload === true || metadata?.audio_upload === true
  const directOptions = Array.isArray(typeOrOptions)
    ? typeOrOptions
    : null
  const metadataOptions = typeOrOptions === 'COMBO' && Array.isArray(metadata?.options)
    ? metadata.options
    : null
  const dynamicOptions = typeOrOptions === 'COMFY_DYNAMICCOMBO_V3'
    ? readDynamicComboOptions(input.definition).map((option) => option.key)
    : null
  const options = directOptions ?? metadataOptions ?? dynamicOptions
  if (options && !uploadInput && !options.some((candidate) => Object.is(candidate, input.value))) {
    if (typeof input.value === 'string') {
      throw input.createOptionMismatchError({
        className: input.className,
        inputName: input.inputName,
        value: input.value,
      })
    }
    throw new Error(
      `COMFYUI_NODE_INPUT_VALUE_INCOMPATIBLE:${input.className}:${input.inputName}:${String(input.value)}`,
    )
  }

  const type = readInputType(input.definition)
  const typeCompatible = (
    (type === 'INT' && Number.isSafeInteger(input.value))
    || (type === 'FLOAT' && typeof input.value === 'number' && Number.isFinite(input.value))
    || (type === 'BOOLEAN' && typeof input.value === 'boolean')
    || ((type === 'STRING' || type === 'COMBO') && typeof input.value === 'string')
  )
  if (!typeCompatible) {
    throw new Error(`COMFYUI_NODE_INPUT_INCOMPATIBLE:${input.className}:${input.inputName}:${type ?? '<unknown>'}`)
  }
  if (
    typeof input.value === 'number'
    && (
      (typeof metadata?.min === 'number' && input.value < metadata.min)
      || (typeof metadata?.max === 'number' && input.value > metadata.max)
    )
  ) {
    throw new Error(
      `COMFYUI_NODE_INPUT_VALUE_INCOMPATIBLE:${input.className}:${input.inputName}:${String(input.value)}`,
    )
  }
}

function assertLinkedInput(input: {
  readonly graph: ComfyUiPromptGraph
  readonly infoByClassName: ReadonlyMap<string, unknown>
  readonly sourceNodeId: string
  readonly sourceOutputIndex: number
  readonly targetClassName: string
  readonly targetInputName: string
  readonly targetDefinition: ComfyUiInputDefinition
}): void {
  const targetType = readInputType(input.targetDefinition)
  if (!targetType || targetType === 'COMBO') {
    throw new Error(
      `COMFYUI_NODE_INPUT_INCOMPATIBLE:${input.targetClassName}:${input.targetInputName}:${targetType ?? '<unknown>'}`,
    )
  }
  const sourceNode = input.graph[input.sourceNodeId]
  if (!sourceNode) throw new Error(`COMFYUI_GRAPH_SOURCE_NODE_MISSING:${input.sourceNodeId}`)
  const sourceInfo = readNodeInfo(
    input.infoByClassName.get(sourceNode.class_type),
    sourceNode.class_type,
  )
  const output = sourceInfo.output
  if (!Array.isArray(output) || output[input.sourceOutputIndex] !== targetType) {
    throw new Error(
      `COMFYUI_NODE_OUTPUT_INCOMPATIBLE:${sourceNode.class_type}:${String(input.sourceOutputIndex)}:${targetType}`,
    )
  }
}

function assertRequiredInputsPresent(input: {
  readonly nodeId: string
  readonly className: string
  readonly graphInputs: Readonly<Record<string, unknown>>
  readonly required: Record<string, unknown> | null
}): void {
  for (const requiredInputName of Object.keys(input.required ?? {})) {
    if (!hasOwn(input.graphInputs, requiredInputName)) {
      throw new Error(
        `COMFYUI_GRAPH_REQUIRED_INPUT_MISSING:${input.nodeId}:${input.className}:${requiredInputName}`,
      )
    }
  }
}

function assertAutogrowCardinality(input: {
  readonly className: string
  readonly graphInputs: Readonly<Record<string, unknown>>
  readonly optional: Record<string, unknown> | null
}): void {
  for (const [groupName, candidate] of Object.entries(input.optional ?? {})) {
    if (!Array.isArray(candidate) || candidate[0] !== 'COMFY_AUTOGROW_V3') continue
    const metadata = asComfyUiRecord(candidate[1])
    const template = asComfyUiRecord(metadata?.template)
    const prefix = typeof template?.prefix === 'string' ? template.prefix : ''
    if (!prefix) {
      throw new Error(`COMFYUI_NODE_INPUT_INCOMPATIBLE:${input.className}:${groupName}:COMFY_AUTOGROW_V3`)
    }
    const indices = Object.keys(input.graphInputs).flatMap((inputName) => {
      const expectedPrefix = `${groupName}.${prefix}`
      if (!inputName.startsWith(expectedPrefix)) return []
      const indexText = inputName.slice(expectedPrefix.length)
      return /^\d+$/u.test(indexText) ? [Number.parseInt(indexText, 10)] : []
    }).sort((left, right) => left - right)
    const minimum = typeof template?.min === 'number' ? template.min : 0
    const maximum = typeof template?.max === 'number' ? template.max : Number.POSITIVE_INFINITY
    if (
      indices.length < minimum
      || indices.length > maximum
      || indices.some((index, position) => index !== position)
    ) {
      throw new Error(`COMFYUI_NODE_INPUT_CARDINALITY_INCOMPATIBLE:${input.className}:${groupName}`)
    }
  }
}

export function assertComfyUiPromptGraphRuntimeContract(input: {
  readonly graph: ComfyUiPromptGraph
  readonly infoByClassName: ReadonlyMap<string, unknown>
  readonly createOptionMismatchError: (input: ComfyUiGraphOptionMismatch) => Error
}): void {
  for (const [nodeId, graphNode] of Object.entries(input.graph)) {
    const nodeInfo = readNodeInfo(
      input.infoByClassName.get(graphNode.class_type),
      graphNode.class_type,
    )
    const nodeInput = asComfyUiRecord(nodeInfo.input)
    const { required, optional } = expandDynamicComboInputs({
      required: asComfyUiRecord(nodeInput?.required),
      optional: asComfyUiRecord(nodeInput?.optional),
      graphInputs: graphNode.inputs,
    })
    assertRequiredInputsPresent({
      nodeId,
      className: graphNode.class_type,
      graphInputs: graphNode.inputs,
      required,
    })
    assertAutogrowCardinality({
      className: graphNode.class_type,
      graphInputs: graphNode.inputs,
      optional,
    })

    for (const [inputName, value] of Object.entries(graphNode.inputs)) {
      const resolved = resolveInputDefinition({
        required,
        optional,
        graphInputs: graphNode.inputs,
        inputName,
      })
      if (!resolved) {
        throw new Error(
          `COMFYUI_GRAPH_INPUT_UNDECLARED:${nodeId}:${graphNode.class_type}:${inputName}`,
        )
      }
      if (isGraphLink(value)) {
        assertLinkedInput({
          graph: input.graph,
          infoByClassName: input.infoByClassName,
          sourceNodeId: value[0],
          sourceOutputIndex: value[1],
          targetClassName: graphNode.class_type,
          targetInputName: inputName,
          targetDefinition: resolved.definition,
        })
      } else {
        assertScalarInput({
          className: graphNode.class_type,
          inputName,
          value,
          definition: resolved.definition,
          createOptionMismatchError: input.createOptionMismatchError,
        })
      }
    }
  }
}
