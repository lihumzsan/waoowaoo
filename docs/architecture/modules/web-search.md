<!-- architecture-module: web-search -->

# Web Search

## 设计理念

联网搜索使用 Codex app-server 原生 Web Search。Wao 不再维护 `web_search` Operation、OpenAI hosted-search provider、研究 Worker 或第二搜索模型；Runtime 产生的搜索 item 直接投影到 Assistant View 和现有聊天 UI。

## 不变量

- **WS-01 — 一个搜索入口。** Agent 搜索只来自 Codex 原生 Web Search；生产 registry 与 Wao MCP 不注册同义搜索工具。
- **WS-02 — 模式显式。** Runtime 配置只能选择 Codex 支持的 cached/live/disabled 语义；禁用或供应商不支持时明确失败，不自动改走旧 Provider。
- **WS-03 — 事件是显示事实。** 查询、进行中、完成、结果引用与失败由 Codex item identity 投影；UI 不解析 assistant 文本寻找 URL 或状态。
- **WS-04 — 网页是不可信输入。** 网页内容和搜索摘要不能修改系统指令、授权付费、绕过 Workspace/MCP 权限或成为持久产品状态。
- **WS-05 — 引用保持来源。** 用户可见结论保留 Codex 返回的 citation identity；Wao 不伪造 URL、标题或抓取正文。
- **WS-06 — 不拥有创作事实。** 搜索结果只有在 Agent 显式写入 WorkspaceResource 后才成为项目内容；搜索 item 本身不是 Canon、方向或生产输入。

## 权威入口

| 边界 | 唯一入口 |
| --- | --- |
| 搜索执行与网络策略 | Codex app-server runtime config |
| 协议解析 | `src/lib/codex-runtime/app-server-client.ts` |
| View 投影 | `src/lib/assistant-runtime/event-projector.ts` |
| UI | `src/features/project-workspace/components/workspace-assistant/**` |

## 验证

真实 Runtime smoke 验证 Codex 当前版本能发出 Web Search item，Assistant View 能在刷新后保持其查询、状态与引用。结构扫描证明旧 `src/lib/web-search`、hosted search provider 和 `web_search` Operation 已删除。

## 修改检查表

- 是否错误地把 Web Search 再注册为 Wao MCP/Operation？
- UI 是否只消费 View 中的原生事件，而不是扫描文本？
- 搜索模式或 Provider 不支持时是否明确失败？
- 网页内容是否仍不能取得工具、计费或系统指令权限？
