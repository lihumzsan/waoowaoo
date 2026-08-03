<!-- architecture-module: web-search -->

# Web Search

## 设计理念

联网搜索使用 Codex app-server 原生 Web Search。Wao 不再维护 `web_search` Operation、OpenAI hosted-search provider、研究 Worker 或第二搜索模型；Runtime 产生的搜索 item 直接投影到 Assistant View 和现有聊天 UI。

## 不变量

- **WS-01 — 一个搜索入口。** Agent 搜索只来自 Codex 原生 Web Search；生产 registry 与 Wao MCP 不注册同义搜索工具。
- **WS-02 — 模式与能力门显式。** Runtime 配置只能选择 Codex 支持的 cached/live/disabled 语义。当前钉死的 Codex 0.146.0 必须在 Wao Responses 网关上显式声明 `supports_standalone_web_search = true`、启用 `features.standalone_web_search` 并选择允许的 `web_search` 模式；Wao 同时关闭未实现的 remote compaction。任一缺失都明确失败，不自动改走旧 Provider，也不得根据 provider 显示名称猜能力。用户选择的 OpenRouter 上游模型和凭证所有权不变。
- **WS-03 — 事件是显示事实。** 查询、进行中、完成、结果引用与失败由 Codex item identity 投影；UI 不解析 assistant 文本寻找 URL 或状态。
- **WS-04 — 网页是不可信输入。** 网页内容和搜索摘要不能修改系统指令、授权付费、绕过 Workspace/MCP 权限或成为持久产品状态。
- **WS-05 — 引用保持来源。** 用户可见结论保留 Codex 返回的 citation identity；Wao 不伪造 URL、标题或抓取正文。
- **WS-06 — 当前能力是查询检索，不伪装完整浏览器。** OpenRouter standalone adapter 当前只接受 `search_query`（含 domain/recency）与 response length；Codex schema 中的 image/open/click/find/screenshot/finance/weather/sports/time 在本 Provider 明确不支持并返回 422。Runtime 指令必须让模型只选择已声明能力，产品不得把这一子集描述成网页浏览或全套数据工具。
- **WS-07 — Runtime capability identity 与上游模型 identity 分权。** OpenRouter 的 OpenAI 模型使用 `openai/<slug>` 作为上游 identity，Codex 内置能力目录使用 `<slug>`。Wao 在唯一 Model Gateway 边界把前者投影为 Runtime slug，并在 Responses 与 `/alpha/search` 出站前恢复当前用户实际选择的上游 id；Assistant View、计费与审计仍只记录真实 modelKey。任何请求携带非当前 Runtime slug 或试图覆盖上游模型都必须拒绝，不能让客户端选第二个模型。
- **WS-07 — 不拥有创作事实。** 搜索结果只有在 Agent 显式写入 WorkspaceResource 后才成为项目内容；搜索 item 本身不是 Canon、方向或生产输入。
- **WS-08 — 仅当前 placement 的活跃 Turn 可搜索。** Runtime bearer nonce 必须仍是该 Project Redis placement 的 owner，随后 standalone search 才验证该 Project 恰好一个活跃 Product Turn。已释放或轮换 placement 的旧 bearer、Turn 外重放、并发状态冲突和浏览器 session 都不能消费用户 Provider。

## 权威入口

| 边界 | 唯一入口 |
| --- | --- |
| 搜索执行与网络策略 | Codex app-server runtime config |
| 自定义 Provider 搜索传输 | Wao Model Gateway `/alpha/search` → OpenRouter Responses Web Search |
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

## 历史回归

- OpenRouter Responses 支持 Web Search，但 Codex 自定义 provider 使用独立 `/alpha/search` 协议。首版只设置 `web_search=live`，under-development feature 默认关闭而完全不向模型暴露工具；第二版钉死 0.144.1 后把自定义 provider 的显示名称伪装为 `OpenAI`，smoke 又只检查协议 schema 是否包含 `webSearch` 类型，没有让真实模型发起搜索。带 OpenRouter 前缀的模型在产品浏览器中因此仍没有搜索工具，助手只能正文声称不可用。当前升级到 0.146.0，使用正式 `supports_standalone_web_search` 能力字段、显式启用 feature，并关闭 Wao 未代理的 remote compaction；Wao gateway 严格转译受支持的搜索请求并保留 URL citation。真实 smoke 与浏览器验收都必须看到完成的原生 `webSearch` item，不能再以 schema 或助手正文自证。
- 能力字段接通后，Wao 仍把 OpenRouter 的 `openai/gpt-5.6-terra` 原样传给 Codex；Codex 内置目录只有 `gpt-5.6-terra`，因此模型被当作未知 capability profile，搜索仍未安装。当前 Model Gateway 显式分离 Runtime slug 与上游 id：只在 Wao 服务端根据已认证用户选择派生，出站前恢复，客户端无法借别名改选模型。
- 原生 Web Search item 已完成并返回引用时，UI 曾始终用动作摘要“正在搜索”覆盖正式 tool state，形成正文已交付、卡片仍运行中的矛盾。当前卡片首行只显示统一 lifecycle resolver 的进行中/成功/失败，查询与页面动作作为无时态详情显示；UI 不从 URL 或助手正文反推终态。
