import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  describe,
  expect,
  it,
  registry,
  resolveProjectAgentToolset,
} from './toolset.fixture'

describe('project agent live toolset registration', () => {
  it('registers read tools, the choice tool, and the full workflow surface for an episode run', () => {
    const result = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })

    expect(result.source).toBe('live-workflow')
    expect(result.operationIds).toEqual(expect.arrayContaining([
      'get_project_context',
      'get_project_snapshot',
      'get_episode_overview',
      'get_chapter_detail',
      'get_task',
      'get_task_batch',
      'list_tasks',
      ...EDIT_FIRST_CHOICE_OPERATION_IDS,
      ...EDIT_FIRST_WORKFLOW_OPERATION_IDS,
    ]))
    expect(result.operationIds).not.toContain('get_task_status')
    expect(result.operationIds).not.toContain('get_project_assets')
    expect(result.operationIds).not.toContain('get_project_data')
  })

  it('keeps the choice tool available without forcing a continuation operation', () => {
    const result = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })

    expect(result.operationIds).toContain('ingest_script')
    expect(result.operationIds).toEqual(expect.arrayContaining([...EDIT_FIRST_CHOICE_OPERATION_IDS]))
    expect(result.includeChoiceOperation).toBe(true)
  })

  it('fails explicitly when a workflow operation is missing from the registry', () => {
    const missingRegistry = registry()
    delete missingRegistry.generate_edit_script_assets

    expect(() => resolveProjectAgentToolset({
      registry: missingRegistry,
      context: { episodeId: 'episode-1' },
    })).toThrow('PROJECT_AGENT_REQUIRED_OPERATION_MISSING:generate_edit_script_assets')
  })
})
