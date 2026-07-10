export type RequirementPriority = 'P0' | 'P1' | 'P2'

export type RequirementCoverageEntry = {
  id: string
  feature: string
  userValue: string
  risk: string
  priority: RequirementPriority
  coverageStatus: 'protected' | 'scenario-required'
  scenarioIds: ReadonlyArray<string>
}

export const REQUIREMENTS_MATRIX: ReadonlyArray<RequirementCoverageEntry> = [
  {
    id: 'REQ-ASSETHUB-CHARACTER-EDIT',
    feature: 'Asset Hub character edit',
    userValue: '角色信息编辑后立即可见并正确保存',
    risk: '字段映射漂移导致保存失败或误写',
    priority: 'P0',
    coverageStatus: 'protected',
    scenarioIds: [
      'ROUTE:asset-hub/characters/[characterId]',
    ],
  },
  {
    id: 'REQ-ASSETHUB-REFERENCE-TO-CHARACTER',
    feature: 'Asset Hub reference-to-character',
    userValue: '上传参考图后生成角色形象且使用参考图',
    risk: 'referenceImages 丢失或分支走错',
    priority: 'P0',
    coverageStatus: 'protected',
    scenarioIds: [
      'ROUTE:asset-hub/reference-to-character',
      'TASKTYPE:reference_to_character',
    ],
  },
  {
    id: 'REQ-NP-GENERATE-IMAGE',
    feature: 'Novel promotion image generation',
    userValue: '角色/场景/分镜图可稳定生成并回写',
    risk: '任务 payload 漂移、worker 写回错误实体',
    priority: 'P0',
    coverageStatus: 'protected',
    scenarioIds: [
      'ROUTE:assets/[assetId]/generate',
      'TASKTYPE:image_panel',
      'SCENARIO-CANVAS-MATERIALIZE-BEFORE-TERMINAL',
    ],
  },
  {
    id: 'REQ-NP-GENERATE-VIDEO',
    feature: 'Novel promotion video generation',
    userValue: '面板视频可生成并可追踪状态',
    risk: 'panel 定位错误、model 能力判断错误、状态错乱',
    priority: 'P0',
    coverageStatus: 'protected',
    scenarioIds: [
      'ROUTE:projects/[projectId]/generate-video',
      'TASKTYPE:video_panel',
    ],
  },
  {
    id: 'REQ-NP-TEXT-ANALYSIS',
    feature: 'Atomic text analysis tasks',
    userValue: '文本分析链路稳定并可回放结果',
    risk: '原子任务结果结构损坏',
    priority: 'P1',
    coverageStatus: 'protected',
    scenarioIds: [
      'ROUTE:projects/[projectId]/bible',
      'TASKTYPE:edit_bible_generate',
      'TASKTYPE:edit_script_generate',
    ],
  },
  {
    id: 'REQ-TASK-STATE-CONSISTENCY',
    feature: 'Task state and SSE consistency',
    userValue: '前端状态与任务真实状态一致',
    risk: 'target-state 与 SSE 失配导致误提示',
    priority: 'P0',
    coverageStatus: 'protected',
    scenarioIds: [
      'ROUTE:tasks',
      'ROUTE:sse',
      'SCENARIO-TASK-QUEUE-UNAVAILABLE-NO-WRITE',
      'SCENARIO-CANVAS-REPLAY-DUPLICATE',
    ],
  },
  {
    id: 'REQ-PROVIDER-PROTOCOL-CONTRACT',
    feature: 'Provider protocol contract',
    userValue: '外部 provider 请求格式、轮询状态和错误分类保持稳定',
    risk: 'provider 协议漂移导致系统链路仅在真实调用时失败',
    priority: 'P0',
    coverageStatus: 'protected',
    scenarioIds: [
      'SCENARIO-PROVIDER-FAILED-TERMINAL',
      'SCENARIO-PROVIDER-UNKNOWN-STATUS',
      'SCENARIO-PROVIDER-COMPLETED-WITHOUT-MEDIA',
      'SCENARIO-PROVIDER-ZERO-FALLBACK',
    ],
  },
  {
    id: 'REQ-TASK-DEDUPE-COMPENSATION',
    feature: 'Task dedupe and enqueue compensation',
    userValue: '重复提交不会卡死，队列失败不会留下脏冻结或孤儿任务',
    risk: '重复任务、孤儿 dedupeKey、enqueue 失败后冻结金额未回滚',
    priority: 'P0',
    coverageStatus: 'protected',
    scenarioIds: [
      'SCENARIO-TASK-ABSENT-JOB-RECOVERY',
      'SCENARIO-TASK-QUEUE-UNAVAILABLE-NO-WRITE',
    ],
  },
  {
    id: 'REQ-API-CONFIG-TUTORIAL-PORTAL',
    feature: 'API config tutorial modal layering',
    userValue: '开通教程浮层只高亮当前教程，不污染其他 provider card',
    risk: '弹层挂载在局部层叠上下文内，导致高亮重叠和误覆盖',
    priority: 'P1',
    coverageStatus: 'scenario-required',
    scenarioIds: [],
  },
  {
    id: 'REQ-INFRA-PUBLIC-ROUTES',
    feature: 'Infra and public routes',
    userValue: '基础公共路由可稳定访问，公开范围明确且有测试兜底',
    risk: '特殊公开路由缺少约束或回归覆盖，导致泄漏、误拦截或行为漂移',
    priority: 'P1',
    coverageStatus: 'protected',
    scenarioIds: [
      'ROUTE:deployment',
      'ROUTE:system/boot-id',
    ],
  },
]
