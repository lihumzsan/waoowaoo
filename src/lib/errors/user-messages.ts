import type { UnifiedErrorCode } from './codes'

export const USER_ERROR_MESSAGES_ZH: Record<UnifiedErrorCode, string> = {
  UNAUTHORIZED: '请先登录后再试。',
  FORBIDDEN: '你没有权限执行此操作。',
  NOT_FOUND: '没有找到对应的数据。',
  INVALID_PARAMS: '请求参数不正确，请检查后重试。',
  MISSING_CONFIG: '系统配置不完整，请联系管理员。',
  CONFLICT: '当前状态冲突，请刷新后重试。',
  TASK_NOT_READY: '任务还在处理中，请稍后。',
  NO_RESULT: '任务已完成，但没有可用结果。',
  RATE_LIMIT: '请求过于频繁，请稍后重试。',
  MODEL_NOT_OPEN: '模型权限未开通。请前往 https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model ，在模型管理页面点击右上角「一键开通所有模型」。',
  MODEL_NOT_REGISTERED: '模型尚未注册，请先完成模型配置后再试。',
  MODEL_NOT_CONFIGURED: '未配置可用模型，请先前往设置页面添加对应类型的模型后再试。',
  QUOTA_EXCEEDED: '额度已用尽，请稍后再试。',
  EXTERNAL_ERROR: '外部服务暂时不可用，请稍后重试。',
  NETWORK_ERROR: '网络异常，请稍后重试。',
  EMPTY_RESPONSE: '模型返回空响应（无有效内容），请稍后重试。',
  MODEL_OUTPUT_TRUNCATED: '模型输出因 token 上限被截断，请调整输出规模后重试。',
  PARSE_ERROR: '模型输出无法解析，请稍后重试。',
  MODEL_OUTPUT_SCHEMA_INVALID: '模型输出格式不符合要求，请稍后重试。',
  PLAN_VALIDATION_FAILED: '模型输出未通过制作规则校验，请修改后重试。',
  EDIT_SCRIPT_ASSET_MENU_EMPTY: '缺少已确认的角色或场景资产，请先确认资产后再生成核心剪辑表。',
  PROVIDER_POLL_FAILED: '外部任务查询失败，请稍后重试。',
  PROVIDER_SUBMIT_FAILED: '外部任务提交失败，请稍后重试。',
  INSUFFICIENT_BALANCE: '余额不足，请充值后重试。',
  SENSITIVE_CONTENT: '内容可能涉及敏感信息，请修改后重试。',
  GENERATION_TIMEOUT: '生成超时，请重试。',
  VIDEO_API_FORMAT_UNSUPPORTED: '当前视频接口格式暂不支持。',
  GENERATION_FAILED: '生成失败，请稍后重试。',
  WATCHDOG_TIMEOUT: '任务执行超时，系统已终止该任务。',
  WORKER_EXECUTION_ERROR: '任务执行失败，请稍后重试。',
  INTERNAL_ERROR: '系统内部错误，请稍后重试。',
}

export function getUserMessageByCode(code: UnifiedErrorCode) {
  return USER_ERROR_MESSAGES_ZH[code]
}
