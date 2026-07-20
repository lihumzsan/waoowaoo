import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CREATIVE_SKILL_IDS,
  CREATIVE_SKILL_REGISTRY,
  readCreativeSkillResource,
} from '@/lib/creative-skills'
import {
  CREATIVE_WORK_TASK_PROTOCOL,
  CREATIVE_WORK_OUTPUT_KINDS,
  creativeWorkOutputRegistry,
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker'
import { createCreativeWorkerTools } from '@/lib/creative-worker/tools'
import { listCreativeWorkerSkillCatalog } from '@/lib/creative-worker/skill-access'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
import { CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA } from '@/lib/creative-resource/schema-registry'

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function collectUnboundedSchemaNodes(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnboundedSchemaNodes(item, `${path}/${String(index)}`, out))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = readRecord(value)
  if (Object.keys(record).length === 0) {
    out.push(path)
    return
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'default') continue
    collectUnboundedSchemaNodes(child, `${path}/${key}`, out)
  }
}

function collectNullableEnumViolations(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNullableEnumViolations(item, `${path}/${String(index)}`, out))
    return
  }
  const record = readRecord(value)
  const types = Array.isArray(record.type) ? record.type : []
  if (types.includes('null') && Array.isArray(record.enum) && !record.enum.includes(null)) {
    out.push(path)
  }
  for (const [key, child] of Object.entries(record)) {
    collectNullableEnumViolations(child, `${path}/${key}`, out)
  }
}

describe('project agent toolset conformance', () => {
  it('exposes every tool-authorized Operation directly from the production registry', () => {
    const registry = createProjectAgentOperationRegistry()
    const expectedOperationIds = Object.values(registry)
      .filter((operation) => operation.channels.tool)
      .map((operation) => operation.id)
      .sort()

    const toolset = resolveProjectAgentToolset({ registry })

    expect(toolset.source).toBe('operation-registry')
    expect(toolset.disabledOperationIds).toEqual([])
    expect(toolset.operationIds).toEqual(expectedOperationIds)
    expect(toolset.operationIds).not.toContain('get_user_api_config')
    expect(toolset.operationIds).not.toContain('put_user_api_config')
    expect(toolset.operationIds).not.toContain('get_user_preference')
    expect(toolset.operationIds).not.toContain('update_user_preference')
    expect(toolset.operationIds).not.toContain('list_user_models')
    expect(toolset.operationIds).not.toContain('get_project_config')
    expect(toolset.operationIds).toContain('update_project_config')
    expect(registry.get_user_api_config.channels).toEqual({ tool: false, api: true })
    expect(registry.put_user_api_config.channels).toEqual({ tool: false, api: true })
    expect(registry.get_user_preference.channels).toEqual({ tool: false, api: true })
    expect(registry.update_user_preference.channels).toEqual({ tool: false, api: true })
    expect(registry.list_user_models.channels).toEqual({ tool: false, api: true })
    expect(registry.get_project_config.channels).toEqual({ tool: false, api: true })
    expect(registry.update_project_config.channels).toEqual({ tool: true, api: true })
    expect(Object.keys(registry.update_project_config.toolInputSchema.properties)).toEqual(['videoRatio'])
  })

  it('can suppress only explicitly named continuation-local tools without changing registry authority', () => {
    const registry = createProjectAgentOperationRegistry()
    const disabledOperationId = Object.values(registry)
      .find((operation) => operation.channels.tool)?.id
    if (!disabledOperationId) throw new Error('TOOL_OPERATION_REQUIRED')

    const toolset = resolveProjectAgentToolset({
      registry,
      disabledOperationIds: [disabledOperationId],
    })

    expect(toolset.disabledOperationIds).toEqual([disabledOperationId])
    expect(toolset.operationIds).not.toContain(disabledOperationId)
    expect(toolset.operationIds).toEqual(
      Object.values(registry)
        .filter((operation) => operation.channels.tool && operation.id !== disabledOperationId)
        .map((operation) => operation.id)
        .sort(),
    )
  })

  it('publishes one explicit Resource generation contract from the production registry', () => {
    const registry = createProjectAgentOperationRegistry()
    const operationIds = ['create_text', 'create_image', 'create_audio', 'create_video'] as const
    const mediaTypes = ['text', 'image', 'audio', 'video'] as const

    for (const [index, operationId] of operationIds.entries()) {
      const operation = registry[operationId]
      const properties = operation.toolInputSchema.properties
      const schemaId = readRecord(properties.schemaId)
      expect(schemaId.enum).toEqual([
        ...CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA[mediaTypes[index] ?? 'text'],
        null,
      ])
      expect(Object.keys(properties)).not.toContain('generationOptions')
      expect(Object.keys(properties)).not.toContain('retryResourceIds')
      expect(Object.keys(properties)).not.toContain('modelKey')
    }

    expect(Object.keys(registry.create_text.toolInputSchema.properties)).toContain('content')
    expect(Object.keys(registry.create_image.toolInputSchema.properties)).toContain('request')
    expect(Object.keys(registry.create_audio.toolInputSchema.properties)).toContain('request')
    for (const operationId of operationIds) {
      expect(Object.keys(registry[operationId].toolInputSchema.properties)).toContain('contextReferences')
      expect(Object.keys(registry[operationId].toolInputSchema.properties)).not.toContain('references')
    }
    expect(Object.keys(registry.create_image.toolInputSchema.properties)).toContain('imageReferences')
    expect(Object.keys(registry.create_video.toolInputSchema.properties)).toContain('imageReferences')
    expect(Object.keys(registry.create_text.toolInputSchema.properties)).not.toContain('imageReferences')
    expect(Object.keys(registry.create_audio.toolInputSchema.properties)).not.toContain('imageReferences')
    expect(Object.keys(registry.create_video.toolInputSchema.properties)).toEqual(expect.arrayContaining([
      'request',
      'durationSeconds',
      'aspectRatio',
      'resolution',
      'fps',
      'generateAudio',
    ]))

    expect(registry.create_text.inputSchema.safeParse({
      prompt: 'Write one line.',
      content: { kind: 'single', text: 'One line.' },
    }).success).toBe(true)
    expect(registry.create_image.inputSchema.safeParse({
      prompt: 'A paper lantern in fog.',
      request: { kind: 'new', count: 2 },
    }).success).toBe(true)
    expect(registry.create_audio.inputSchema.safeParse({
      prompt: 'Sparse ritual drums.',
      request: { kind: 'new', count: 1 },
      durationSeconds: 15,
    }).success).toBe(true)
    expect(registry.create_video.inputSchema.safeParse({
      prompt: 'A slow push toward a moonlit shrine.',
      request: { kind: 'new', count: 1 },
      durationSeconds: 15,
    }).success).toBe(true)
    expect(registry.create_video.inputSchema.safeParse({
      prompt: 'Old provider-shaped input.',
      count: 1,
      generationOptions: { durationSeconds: 15 },
    }).success).toBe(false)
    expect(registry.create_video.inputSchema.safeParse({
      prompt: 'Agent-selected model input.',
      modelKey: 'provider::model',
      request: { kind: 'new', count: 1 },
    }).success).toBe(false)
    expect(registry.create_image.inputSchema.safeParse({
      prompt: 'Legacy ambiguous reference input.',
      request: { kind: 'new', count: 1 },
      references: [],
    }).success).toBe(false)
  })

  it('publishes exact retry, segment, and task branches without Agent model configuration', () => {
    const registry = createProjectAgentOperationRegistry()
    const requestSchema = readRecord(registry.create_video.toolInputSchema.properties.request)
    const requestKinds = (Array.isArray(requestSchema.oneOf) ? requestSchema.oneOf : [])
      .map((branch) => readRecord(readRecord(readRecord(branch).properties).kind).const)
    expect(requestKinds).toEqual(['new', 'retry'])

    const scopeSchema = readRecord(registry.generate_video_segments.toolInputSchema.properties.scope)
    const scopeKinds = (Array.isArray(scopeSchema.oneOf) ? scopeSchema.oneOf : [])
      .map((branch) => readRecord(readRecord(readRecord(branch).properties).kind).const)
    expect(scopeKinds).toEqual(['pending', 'segment'])

    expect(Object.keys(registry.list_tasks.toolInputSchema.properties)).toEqual(expect.arrayContaining([
      'targetType', 'targetId', 'status', 'type', 'limit',
    ]))
    expect(Object.keys(registry.get_task.toolInputSchema.properties)).toEqual([
      'taskId', 'includeEvents', 'eventsLimit',
    ])
    expect(Object.keys(registry.generate_project_music.toolInputSchema.properties)).not.toContain('musicModel')
    expect(Object.keys(registry.plan_episode_bgm_design.toolInputSchema.properties)).not.toContain('musicModel')
    expect(Object.keys(registry.generate_episode_bgm_score.toolInputSchema.properties)).not.toContain('musicModel')
  })

  it('uses dedicated exact-revision operations for canonical screenplay and Style Bible bindings', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(registry.confirm_script_resource.channels.tool).toBe(true)
    expect(Object.keys(registry.confirm_script_resource.toolInputSchema.properties)).toEqual([
      'resourceId', 'revisionId', 'expectedVersion',
    ])
    expect(registry.confirm_script_resource.inputSchema.safeParse({
      resourceId: 'resource:screenplay',
      revisionId: 'revision:screenplay',
      expectedVersion: null,
    }).success).toBe(true)

    expect(registry.adopt_style_bible.inputSchema.safeParse({
      taskId: 'task:style',
      name: 'Final style',
      selection: { kind: 'candidate', styleKey: 'style_b' },
      expectedVersion: null,
    }).success).toBe(true)
    expect(registry.adopt_style_bible.inputSchema.safeParse({
      taskId: 'task:style',
      name: 'Final style',
      selection: { kind: 'candidate', styleKey: 'style_unknown' },
    }).success).toBe(false)
  })

  it('exposes one background Creative Worker delegation contract without domain write authority', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.delegate_creative_work

    expect(operation).toBeDefined()
    expect(operation.channels).toEqual({ tool: true, api: false })
    expect(operation.groupPath).toEqual(['assistant', 'creative'])
    expect(operation.intent).toBe('act')
    expect(operation.confirmation).toMatchObject({ kind: 'none', required: false })
    expect(operation.effects).toEqual({
      writes: true,
      workspaceResourceImpact: 'none',
      billable: false,
      destructive: false,
      overwrite: false,
      bulk: true,
      externalSideEffects: true,
      longRunning: true,
    })
    expect(Object.keys(operation.toolInputSchema.properties)).toEqual(['delegation'])
    const delegationSchema = readRecord(operation.toolInputSchema.properties.delegation)
    const sourceBranches = (Array.isArray(delegationSchema.oneOf) ? delegationSchema.oneOf : [])
      .map((branch) => readRecord(readRecord(readRecord(branch).properties).source).const)
    expect(sourceBranches).toEqual(['requests', 'chapters'])
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'short-video-1',
          outputKind: 'video_prompt_set',
          goal: 'Design the complete requested video.',
          targetDurationSeconds: 60,
          context: {
            userRequest: 'A lantern wakes in an abandoned shrine.',
            sourceMaterials: [],
            constraints: ['Preserve the same lantern identity throughout.'],
          },
        }],
      },
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      delegation: { source: 'requests', requests: [] },
    }).success).toBe(false)
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'chapters',
        chapters: [{ chapterId: 'chapter-1', requestKey: 'chapter-1-video' }],
        outputKind: 'video_prompt_set',
        goal: 'Design this Chapter as executable video generations.',
        userRequest: 'Produce the complete long-form story.',
        constraints: ['Preserve continuity with adjacent Chapters.'],
        referencedAssets: [],
      },
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'legacy-null-branches',
          outputKind: 'creative_review',
          goal: 'Review the supplied result.',
          context: { userRequest: '', sourceMaterials: [], constraints: [] },
        }],
        request: null,
        chapterBatch: null,
      },
    }).success).toBe(false)
  })

  it('keeps every Creative Skill flat, localized, registry-addressed, and Worker-readable', async () => {
    expect(Object.keys(CREATIVE_SKILL_REGISTRY)).toEqual([...CREATIVE_SKILL_IDS])

    for (const skillId of CREATIVE_SKILL_IDS) {
      const definition = CREATIVE_SKILL_REGISTRY[skillId]
      const skillDir = path.join(process.cwd(), 'src', 'lib', 'creative-skills', 'skills', skillId)
      expect(fs.readdirSync(skillDir).sort(), skillId).toEqual([
        'SKILL.en.md', 'SKILL.zh.md',
      ])
      expect(definition.entryUri).toBe(`skill://${skillId}/SKILL.md`)

      for (const locale of ['zh', 'en'] as const) {
        const resource = await readCreativeSkillResource({
          locale,
          uri: definition.entryUri,
        })
        expect(resource.skillId).toBe(skillId)
        expect(resource.locale).toBe(locale)
        expect(resource.content.trim().length).toBeGreaterThan(0)
        expect(resource.checksum).toMatch(/^[a-f0-9]{64}$/)
      }
    }
  })

  it('gives the Creative Worker the complete Skill catalog and one autonomous read tool', () => {
    expect(createCreativeWorkerTools().map((tool) => tool.name)).toEqual(['read_skill'])
    expect(listCreativeWorkerSkillCatalog('zh').map((skill) => skill.id)).toEqual([
      ...CREATIVE_SKILL_IDS,
    ])
    expect(listCreativeWorkerSkillCatalog('en').every((skill) => (
      skill.title.length > 0 && skill.summary.length > 0 && skill.entryUri.startsWith('skill://')
    ))).toBe(true)
    expect(Object.keys(creativeWorkOutputRegistry)).toEqual([...CREATIVE_WORK_OUTPUT_KINDS])
    expect(Object.values(creativeWorkOutputRegistry).every((definition) => (
      !('requiredSkillIds' in definition)
    ))).toBe(true)

    const videoOutput = {
      kind: 'video_prompt_set',
      segments: [{
        key: 'clip-1',
        durationSeconds: 10,
        prompt: '10-second 16:9 cinematic video. 0-10s: slow push toward a lantern that ignites as the shrine doors open; preserve the shrine layout and generate synchronized wind, timber creaks, and one ignition pulse.',
        referenceKeys: [],
      }],
    }
    expect(creativeWorkOutputRegistry.video_prompt_set.schema.safeParse(videoOutput).success).toBe(true)
    expect(creativeWorkOutputRegistry.video_prompt_set.schema.safeParse({
      ...videoOutput,
      segments: undefined,
      shots: videoOutput.segments,
    }).success).toBe(false)
    expect(creativeWorkOutputRegistry.video_prompt_set.schema.safeParse({
      ...videoOutput,
      globalDirection: { narrativeIntent: 'Legacy parallel planning authority.' },
    }).success).toBe(false)
  })

  it('keeps the Creative Task protocol explicit and its repeated result projections consistent', () => {
    expect(CREATIVE_WORK_TASK_PROTOCOL).toBe('creative_work_v3')
    const lifecycleProjection = {
      requestKey: 'review-1',
      outputKind: 'creative_review' as const,
      goal: 'Review the supplied result.',
      events: [{
        sequence: 1,
        occurredAt: '2026-07-20T00:00:00.000Z',
        event: {
          kind: 'started' as const,
          outputKind: 'creative_review' as const,
          goal: 'Review the supplied result.',
        },
      }],
    }
    const payload = {
      protocol: CREATIVE_WORK_TASK_PROTOCOL,
      requestKey: 'review-1',
      request: {
        outputKind: 'creative_review' as const,
        goal: 'Review the supplied result.',
        context: { userRequest: '', sourceMaterials: [], constraints: [] },
        productionContext: { video: null },
      },
      modelKey: 'test:model',
      inputFingerprint: 'fingerprint',
      origin: { runId: 'run-1', toolCallId: 'tool-1' },
      lifecycleProjection,
      ui: { progressGroupId: 'operation:delegate_creative_work:request-1' },
      meta: {
        locale: 'zh',
        flowId: 'creative-work',
        flowStageIndex: 1,
        flowStageTotal: 1,
        trace: { requestId: 'request-1' },
      },
    }
    expect(creativeWorkTaskPayloadSchema.safeParse(payload).success).toBe(true)
    expect(creativeWorkTaskPayloadSchema.safeParse({
      ...payload,
      protocol: undefined,
    }).success).toBe(false)
    expect(creativeWorkTaskPayloadSchema.safeParse({
      ...payload,
      protocol: 'creative_work_v2',
    }).success).toBe(false)

    const result = {
      requestKey: 'review-1',
      outputKind: 'creative_review' as const,
      summary: 'The result is coherent.',
      continuationProjection: {
        requestKey: 'review-1',
        outputKind: 'creative_review' as const,
        summary: 'The result is coherent.',
      },
      lifecycleProjection,
      creativeWorkResult: {
        outputKind: 'creative_review' as const,
        output: {
          kind: 'creative_review' as const,
          verdict: 'pass' as const,
          summary: 'The result is coherent.',
          findings: [],
          preservedStrengths: [],
          assumptions: [],
        },
        skillTrace: [{
          ordinal: 1,
          source: 'tool' as const,
          skillId: 'quality-review' as const,
          version: '1',
          uri: 'skill://quality-review/SKILL.md',
          checksum: 'checksum',
          contentChars: 100,
        }],
        metrics: { readCalls: 1, skillContentChars: 100 },
        budgets: {
          maxTurns: 8,
          maxReadCalls: 8,
          maxSkillContentChars: 100_000,
          maxSingleSkillResourceChars: 50_000,
          maxInputChars: 1_000_000,
          maxOutputChars: 100_000,
        },
      },
    }
    expect(creativeWorkTaskResultSchema.safeParse(result).success).toBe(true)
    expect(creativeWorkTaskResultSchema.safeParse({
      ...result,
      continuationProjection: {
        ...result.continuationProjection,
        summary: 'Contradictory summary.',
      },
    }).success).toBe(false)
    expect(creativeWorkTaskResultSchema.safeParse({
      ...result,
      creativeWorkResult: {
        ...result.creativeWorkResult,
        skillTrace: [{
          ...result.creativeWorkResult.skillTrace[0],
          skillId: 'invented-skill',
        }],
      },
    }).success).toBe(false)
  })

  it('contains no anonymous permissive schemas or nullable enums that reject null', () => {
    const registry = createProjectAgentOperationRegistry()
    const unbounded: string[] = []
    const nullableEnumViolations: string[] = []

    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      for (const [property, schema] of Object.entries(operation.toolInputSchema.properties)) {
        collectUnboundedSchemaNodes(schema, `${operation.id}/${property}`, unbounded)
      }
      collectNullableEnumViolations(operation.toolInputSchema, operation.id, nullableEnumViolations)
    }

    expect(unbounded).toEqual([])
    expect(nullableEnumViolations).toEqual([])
  })
})
