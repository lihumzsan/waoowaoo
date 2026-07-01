import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { EDIT_FIRST_CHOICE_OPERATION_IDS } from '@/lib/project-agent/edit-first-choice-tools'

describe('project agent operation registry', () => {
  it('keeps operation ids aligned and core fields defined', () => {
    const registry = createProjectAgentOperationRegistry()
    for (const [id, operation] of Object.entries(registry)) {
      expect(operation.id).toBe(id)
      expect(operation.summary.trim().length).toBeGreaterThan(0)
      expect(Array.isArray(operation.groupPath)).toBe(true)
      expect(operation.groupPath.length).toBeGreaterThan(0)
      expect(typeof operation.channels.tool).toBe('boolean')
      expect(typeof operation.channels.api).toBe('boolean')
      expect(['required', 'optional', 'forbidden']).toContain(operation.prerequisites.episodeId)
      expect(typeof operation.confirmation.required).toBe('boolean')
      expect(typeof operation.effects.writes).toBe('boolean')
      expect(typeof operation.effects.billable).toBe('boolean')
      expect(typeof operation.effects.destructive).toBe('boolean')
      expect(typeof operation.effects.overwrite).toBe('boolean')
      expect(typeof operation.effects.bulk).toBe('boolean')
      expect(typeof operation.effects.externalSideEffects).toBe('boolean')
      expect(typeof operation.effects.longRunning).toBe('boolean')
      expect(operation.inputSchema).toBeDefined()
      expect(operation.outputSchema).toBeDefined()
      expect(typeof operation.inputSchema.safeParse).toBe('function')
      expect(typeof operation.outputSchema.safeParse).toBe('function')
    }
  })

  it('keeps storyboard tools atomic and assistant-visible', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(registry.mutate_storyboard).toBeUndefined()
    expect(registry.modify_asset_image).toBeUndefined()
    expect(registry.generate_video).toBeUndefined()
    expect(registry.modify_character_image).toBeUndefined()
    expect(registry.modify_location_image).toBeUndefined()
    expect(registry.delete_storyboard_panel).toBeUndefined()
    expect(registry.update_storyboard_panel_prompt?.channels?.tool ?? true).toBe(true)
    expect(registry.generate_panel_video?.channels).toEqual({ tool: false, api: true })
    expect(registry.generate_episode_videos?.channels?.api ?? false).toBe(true)
    expect(registry.generate_episode_videos?.channels).toEqual({ tool: true, api: true })
    expect(registry.generate_video_group?.channels).toEqual({ tool: false, api: true })
    expect(registry.generate_episode_video_groups?.channels).toEqual({ tool: false, api: true })
    expect(registry.generate_episode_videos_auto?.channels).toEqual({ tool: false, api: true })
    expect(registry.generate_asset_reference_video?.channels).toEqual({ tool: false, api: true })
    expect(registry.generate_episode_asset_reference_videos?.channels).toEqual({ tool: false, api: true })
    expect(registry.render_final_video?.channels).toEqual({ tool: true, api: true })
    expect(registry.generate_edit_screenplay?.channels).toEqual({ tool: true, api: true })
    expect(registry.generate_edit_style_previews?.channels).toEqual({ tool: true, api: true })
    expect(registry.generate_edit_script?.channels).toEqual({ tool: true, api: true })
    expect(registry.generate_edit_script_assets?.channels).toEqual({ tool: true, api: true })
    expect(registry.generate_edit_shot_execution_plan?.channels).toEqual({ tool: true, api: true })
    expect(registry.generate_edit_script_storyboard?.channels).toEqual({ tool: true, api: true })
    for (const operationId of EDIT_FIRST_CHOICE_OPERATION_IDS) {
      expect(registry[operationId]?.channels).toEqual({ tool: true, api: true })
      expect(registry[operationId]?.intent).toBe('query')
    }

    expect(registry.update_storyboard_panel_prompt?.groupPath).toEqual(['storyboard', 'edit'])
    expect(registry.generate_edit_screenplay?.groupPath).toEqual(['edit-script'])
    expect(registry.generate_edit_style_previews?.groupPath).toEqual(['edit-script'])
    expect(registry.generate_edit_script?.groupPath).toEqual(['edit-script'])
    expect(registry.generate_edit_script_assets?.groupPath).toEqual(['edit-script'])
    expect(registry.generate_edit_shot_execution_plan?.groupPath).toEqual(['edit-script'])
    expect(registry.generate_edit_script_storyboard?.groupPath).toEqual(['edit-script'])
    for (const operationId of EDIT_FIRST_CHOICE_OPERATION_IDS) {
      expect(registry[operationId]?.groupPath).toEqual(['edit-script'])
    }

    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      expect(operation.groupPath).not.toEqual(['storyboard'])
    }
  })

  it('limits project read tool descriptions to concrete detail reads', () => {
    const registry = createProjectAgentOperationRegistry()
    const contextOperation = registry.get_project_context
    const snapshotOperation = registry.get_project_snapshot

    expect(contextOperation).toBeDefined()
    expect(contextOperation.summary).toContain('only when the injected project_state_snapshot and conversation context are insufficient')
    expect(contextOperation.summary).toContain('full screenplay text, historical operation results, failure details, active task details, or asset/storyboard/panel fields')
    expect(contextOperation.summary).toContain('Do not call merely to confirm the current phase, progress, next action, projectId, episodeId, approval state, or system-derived tool parameters')
    expect(snapshotOperation).toBeDefined()
    expect(snapshotOperation.summary).toContain('only when the injected project_state_snapshot and conversation context are insufficient')
    expect(snapshotOperation.summary).toContain('Do not call merely to confirm the current phase, progress, next action, projectId, episodeId, approval state, general status, or system-derived tool parameters')
    expect(snapshotOperation.summary).toContain('Use detail=full only when panel fields, prompts, descriptions, or media URLs are explicitly needed')
  })

  it('registers project music generation as a billable tool/api operation without pre-confirmation', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.generate_project_music

    expect(operation).toBeDefined()
    expect(operation.channels).toEqual({ tool: true, api: true })
    expect(operation.groupPath).toEqual(['media', 'music'])
    expect(operation.confirmation.required).toBe(false)
    expect(operation.effects).toEqual({
      writes: true,
      billable: true,
      destructive: false,
      overwrite: false,
      bulk: false,
      externalSideEffects: true,
      longRunning: true,
    })
  })

  it('allows edit-first auto-approved operations to stay assistant-callable without confirmation', () => {
    const registry = createProjectAgentOperationRegistry()
    for (const operationId of [
      'generate_edit_style_previews',
    ] as const) {
      const operation = registry[operationId]
      expect(operation).toBeDefined()
      expect(operation.channels).toEqual({ tool: true, api: true })
      expect(operation.effects.bulk).toBe(true)
      expect(operation.confirmation.required).toBe(false)
    }
  })

  it('registers final video render as a confirmed but non-billable assistant-callable operation', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.render_final_video

    expect(operation).toBeDefined()
    expect(operation.channels).toEqual({ tool: true, api: true })
    expect(operation.groupPath).toEqual(['media', 'video'])
    expect(operation.confirmation.required).toBe(true)
    expect(operation.prerequisites.episodeId).toBe('required')
    expect(operation.effects).toEqual({
      writes: true,
      billable: false,
      destructive: false,
      overwrite: true,
      bulk: true,
      externalSideEffects: true,
      longRunning: true,
    })
  })

  it('does not register removed skill gateway operations', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(registry.search_skills).toBeUndefined()
    expect(registry.load_skill).toBeUndefined()
    expect(registry.create_plan).toBeUndefined()
    expect(registry.validate_plan).toBeUndefined()
    expect(registry.execute_plan).toBeUndefined()
    expect(registry.invoke_operation).toBeUndefined()
    expect(registry.list_skill_catalog).toBeUndefined()
    expect(registry.list_saved_skills).toBeUndefined()
  })
})
