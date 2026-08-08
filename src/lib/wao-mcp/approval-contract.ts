export const WAO_MCP_APPROVAL_META_KEY = 'wao.dev/approval-request-id'

export function isWaoMcpApprovalRequestMeta(
  meta: Readonly<Record<string, unknown>> | null,
): boolean {
  const requestId = meta?.[WAO_MCP_APPROVAL_META_KEY]
  return typeof requestId === 'string' && requestId.trim().length > 0
}
