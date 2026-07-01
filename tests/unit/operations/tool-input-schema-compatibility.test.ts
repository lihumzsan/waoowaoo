import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'

function collectBooleanEnums(value: unknown, out: unknown[][]) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectBooleanEnums(item, out)
    return
  }
  const record = value as Record<string, unknown>
  if (Array.isArray(record.enum) && record.enum.some((item) => typeof item === 'boolean')) {
    out.push(record.enum)
  }
  for (const child of Object.values(record)) {
    collectBooleanEnums(child, out)
  }
}

function collectConfirmedProperties(value: unknown, out: string[], path = '#') {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectConfirmedProperties(item, out, `${path}/${String(index)}`))
    return
  }
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties) && 'confirmed' in properties) {
    out.push(`${path}/properties/confirmed`)
  }
  for (const [key, child] of Object.entries(record)) {
    collectConfirmedProperties(child, out, `${path}/${key}`)
  }
}

function collectNeverProperties(value: unknown, out: string[], path = '#') {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNeverProperties(item, out, `${path}/${String(index)}`))
    return
  }
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [key, property] of Object.entries(properties)) {
      if (!property || typeof property !== 'object' || Array.isArray(property)) continue
      const not = (property as Record<string, unknown>).not
      if (not && typeof not === 'object' && !Array.isArray(not) && Object.keys(not).length === 0) {
        out.push(`${path}/properties/${key}`)
      }
    }
  }
  for (const [key, child] of Object.entries(record)) {
    collectNeverProperties(child, out, `${path}/${key}`)
  }
}

function collectOptionalProperties(value: unknown, out: string[], path = '#') {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectOptionalProperties(item, out, `${path}/${String(index)}`))
    return
  }
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const required = Array.isArray(record.required)
      ? record.required.filter((item): item is string => typeof item === 'string')
      : []
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) out.push(`${path}/properties/${key}`)
    }
  }
  for (const [key, child] of Object.entries(record)) {
    collectOptionalProperties(child, out, `${path}/${key}`)
  }
}

describe('tool input schema compatibility', () => {
  it('does not emit boolean enum values in tool parameter schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; enum: unknown[] }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const enums: unknown[][] = []
      collectBooleanEnums(operation.toolInputSchema, enums)
      for (const e of enums) {
        violations.push({ id: operation.id, enum: e })
      }
    }
    expect(violations).toEqual([])
  })

  it('does not expose internal confirmation fields in model-facing tool schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectConfirmedProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })

  it('never exposes z.never() guard fields in model-facing tool schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectNeverProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })

  it('hides the forbidden prompt field of generate_edit_script from the model but still rejects it at execution', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.generate_edit_script
    expect(operation).toBeDefined()
    expect(Object.keys(operation.toolInputSchema.properties)).not.toContain('prompt')
    expect(operation.toolInputSchema.required).not.toContain('prompt')

    const parsed = operation.inputSchema.safeParse({
      confirmed: true,
      prompt: 'should be rejected',
      screenplayId: 'screenplay-1',
    })
    expect(parsed.success).toBe(false)

    const parsedWithoutPrompt = operation.inputSchema.safeParse({
      confirmed: true,
      screenplayId: 'screenplay-1',
    })
    expect(parsedWithoutPrompt.success).toBe(true)
  })

  it('exposes only user-intent fields for edit-first workflow tools', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(Object.keys(registry.generate_edit_screenplay.toolInputSchema.properties)).toEqual([
      'prompt',
      'durationTier',
      'aspectRatio',
    ])
    expect(Object.keys(registry.revise_edit_screenplay.toolInputSchema.properties)).toEqual([
      'revisionInstruction',
      'durationTier',
      'aspectRatio',
    ])
    expect(Object.keys(registry.generate_edit_style_previews.toolInputSchema.properties)).toEqual([
      'styleDirection',
    ])
    expect(Object.keys(registry.revise_edit_script_assets.toolInputSchema.properties)).toEqual([
      'revisionNotes',
    ])

    for (const operationId of [
      'generate_edit_screenplay',
      'revise_edit_screenplay',
      'generate_edit_style_previews',
      'revise_edit_script_assets',
    ]) {
      const properties = Object.keys(registry[operationId]?.toolInputSchema.properties ?? {})
      expect(properties).not.toContain('episodeId')
      expect(properties).not.toContain('screenplayId')
      expect(properties).not.toContain('editScriptId')
      expect(properties).not.toContain('storyboardId')
      expect(properties).not.toContain('panelId')
      expect(properties).not.toContain('requirementId')
      expect(properties).not.toContain('count')
      expect(properties).not.toContain('limit')
      expect(properties).not.toContain('generationOptions')
    }
  })

  it('uses empty model-facing schemas for context-derived edit-first task submissions', () => {
    const registry = createProjectAgentOperationRegistry()
    const emptyOperationIds = [
      'request_edit_duration_aspect_ratio_choice',
      'request_edit_screenplay_review_choice',
      'request_edit_style_choice',
      'request_edit_asset_review_choice',
      'generate_edit_script',
      'generate_edit_script_assets',
      'generate_edit_shot_execution_plan',
      'generate_edit_script_storyboard',
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'generate_episode_bgm_score',
      'render_final_video',
    ]

    for (const operationId of emptyOperationIds) {
      const operation = registry[operationId]
      expect(operation).toBeDefined()
      expect(operation?.toolInputSchema).toEqual({
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      })
    }
  })

  it('accepts empty execution input for context-derived BGM generation', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.generate_episode_bgm_score

    expect(operation.inputSchema.safeParse({}).success).toBe(true)
  })

  it('accepts screenplay revision execution input without backfilled duration or aspect ratio', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.revise_edit_screenplay

    expect(operation.inputSchema.safeParse({
      revisionInstruction: 'Make the ending quieter and more ambiguous.',
    }).success).toBe(true)
  })

  it('does not expose system-managed video model fields in model-facing video tool schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const operationIds = [
      'generate_panel_video',
      'generate_episode_videos',
      'generate_video_group',
      'generate_episode_video_groups',
      'generate_episode_videos_auto',
      'generate_asset_reference_video',
      'generate_episode_asset_reference_videos',
    ]

    for (const operationId of operationIds) {
      const operation = registry[operationId]
      expect(operation).toBeDefined()
      expect(Object.keys(operation.toolInputSchema.properties)).not.toContain('videoModel')
      expect(Object.keys(operation.toolInputSchema.properties)).not.toContain('groupVideoModel')
      expect(operation.toolInputSchema.required).not.toContain('videoModel')
      expect(operation.toolInputSchema.required).not.toContain('groupVideoModel')
    }
  })

  it('makes every model-facing tool property required for OpenAI strict schema conversion', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectOptionalProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })
})
