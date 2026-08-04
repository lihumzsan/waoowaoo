<!-- architecture-module: web-search -->

# Web Search

## 设计理念

联网搜索使用 Codex app-server 原生 Web Search。Wao 不再维护 `web_search` Operation、OpenAI hosted-search provider、研究 Worker 或第二搜索模型；Runtime 产生的搜索 item 直接投影到 Assistant View 和现有聊天 UI。

## 不变量

- **WS-01 — 一个搜索入口。** Agent 搜索只来自 Codex 原生 Web Search；生产 registry 与 Wao MCP 不注册同义搜索工具。
- **WS-02 — 模式与能力门显式。** Runtime 配置只能选择 Codex 支持的 cached/live/disabled 语义。当前钉死的 Codex 0.146.0 必须在 Wao Responses 网关上显式声明 `supports_standalone_web_search = true`、启用 `features.standalone_web_search` 并选择允许的 `web_search` 模式；Wao 同时关闭未实现的 remote compaction。任一缺失都明确失败，不自动改走旧 Provider，也不得根据 provider 显示名称猜能力。用户选择的 OpenRouter 上游模型和凭证所有权不变。
- **WS-03 — 事件是显示事实。** 查询、进行中、完成、结果引用、来源预览与失败由 Codex item identity 投影；projector 必须保留 app-server `results`，UI 不解析 assistant 文本寻找 URL 或状态。进行中的搜索必须显示 item 自己声明的 `query`——静默的多秒等待是用户唯一无法解释的状态；该查询词只能来自 item 契约字段，完成后即让位给来源卡，且任何生命周期判定仍只来自统一 resolver，不得用 query/action 反推状态。UI 不展示原始 arguments JSON、内部命令名或 provider payload。
- **WS-04 — 网页是不可信输入。** 网页内容和搜索摘要不能修改系统指令、授权付费、绕过 Workspace/MCP 权限或成为持久产品状态。
- **WS-05 — 引用保持来源。** 用户可见结论保留 Codex 返回的 citation identity。来源卡只消费 citation URL/title/domain；可选图片是该来源页公开声明的 Open Graph/Twitter preview，经 SSRF 校验和有界 HTML 读取取得，并始终链接回原来源。Wao 不伪造 URL、标题或把预览当成项目媒体。
- **WS-06 — 当前能力是查询检索，不伪装完整浏览器。** OpenRouter standalone adapter 接受 `search_query` 与 `image_query`（含 domain/recency）及 response length；`image_query` 仍通过同一搜索 Provider 找到带公开预览图的来源页，不谎称 OpenRouter 提供独立图片索引。Codex schema 中的 open/click/find/screenshot/finance/weather/sports/time 在本 Provider 明确不支持并返回 422。Runtime 指令必须让模型只选择已声明能力，产品不得把这一子集描述成完整浏览器或全套数据工具。
- **WS-07 — Runtime capability identity 与上游模型 identity 分权。** OpenRouter 的 OpenAI 模型使用 `openai/<slug>` 作为上游 identity，Codex 内置能力目录使用 `<slug>`。Wao 在唯一 Model Gateway 边界把前者投影为 Runtime slug，并在 Responses 与 `/alpha/search` 出站前恢复当前用户实际选择的上游 id；Assistant View、计费与审计仍只记录真实 modelKey。任何请求携带非当前 Runtime slug 或试图覆盖上游模型都必须拒绝，不能让客户端选第二个模型。
- **WS-08 — 不拥有创作事实。** 搜索结果只有在 Agent 显式写入 WorkspaceResource 后才成为项目内容；搜索 item 和来源预览本身不是 Canon、方向或生产输入。
- **WS-09 — 仅当前 placement 的活跃 Turn 可搜索。** Runtime bearer nonce 必须仍是该 Project Redis placement 的 owner，随后 standalone search 才验证该 Project 恰好一个活跃 Product Turn。已释放或轮换 placement 的旧 bearer、Turn 外重放、并发状态冲突和浏览器 session 都不能消费用户 Provider。
- **WS-10 — 重复规范查询复用同一结果。** Gateway 以 active `turnId + canonical query/model/settings` 为 identity，在单进程内合并并发请求，并以短期 Redis 结果复用已完成的相同重放；失败不缓存、不同 Turn 不共享。跨实例同时首次到达不承诺分布式 exactly-once，不能为这一表现层优化引入第二套搜索锁状态机。Codex item 可保留各自协议 identity，但 UI 聚合成一条语义搜索记录，不能把模型重复调用伪装成两条用户操作。

## 权威入口

| 边界 | 唯一入口 |
| --- | --- |
| 搜索执行与网络策略 | Codex app-server runtime config |
| 自定义 Provider 搜索传输 | Wao Model Gateway `/alpha/search` → OpenRouter Responses Web Search |
| 协议解析 | `src/lib/codex-runtime/app-server-client.ts` |
| View 投影 | `src/lib/assistant-runtime/event-projector.ts` |
| UI | `src/features/project-workspace/components/workspace-assistant/**` |

## 验证

真实 Runtime smoke 应验证 Codex 当前版本能发出 Web Search item，Assistant View 能在刷新后保持状态、引用、来源卡和可用的网页图片预览；同一 Turn 已完成的相同规范查询应复用结果。结构扫描证明旧 `src/lib/web-search`、hosted search provider 和 `web_search` Operation 已删除。

## 修改检查表

- 是否错误地把 Web Search 再注册为 Wao MCP/Operation？
- UI 是否只消费 View 中的原生事件，而不是扫描文本？
- 搜索模式或 Provider 不支持时是否明确失败？
- 网页内容是否仍不能取得工具、计费或系统指令权限？

## 历史回归

- OpenRouter Responses 支持 Web Search，但 Codex 自定义 provider 使用独立 `/alpha/search` 协议。首版只设置 `web_search=live`，under-development feature 默认关闭而完全不向模型暴露工具；第二版钉死 0.144.1 后把自定义 provider 的显示名称伪装为 `OpenAI`，smoke 又只检查协议 schema 是否包含 `webSearch` 类型，没有让真实模型发起搜索。带 OpenRouter 前缀的模型在产品浏览器中因此仍没有搜索工具，助手只能正文声称不可用。当前升级到 0.146.0，使用正式 `supports_standalone_web_search` 能力字段、显式启用 feature，并关闭 Wao 未代理的 remote compaction；Wao gateway 严格转译受支持的搜索请求并保留 URL citation。真实 smoke 与浏览器验收都必须看到完成的原生 `webSearch` item，不能再以 schema 或助手正文自证。
- 能力字段接通后，Wao 仍把 OpenRouter 的 `openai/gpt-5.6-terra` 原样传给 Codex；Codex 内置目录只有 `gpt-5.6-terra`，因此模型被当作未知 capability profile，搜索仍未安装。当前 Model Gateway 显式分离 Runtime slug 与上游 id：只在 Wao 服务端根据已认证用户选择派生，出站前恢复，客户端无法借别名改选模型。
- 原生 Web Search item 已完成并返回引用时，UI 曾始终用动作摘要“正在搜索”覆盖正式 tool state，形成正文已交付、卡片仍运行中的矛盾。当前卡片首行只显示统一 lifecycle resolver 的进行中/成功/失败，完成后展示结构化来源卡。修正该缺陷时连带把进行中的 `query` 也一并隐藏，导致联网检索期间界面完全沉默、用户无法判断是否卡死；这是把“不得用 query 反推状态”过度扩大成“不得显示 query”。当前区分两者：生命周期仍只由 resolver 判定，进行中额外显示 item 契约里的 `query`，完成后收起。
- Standalone gateway 已把 citation `results` 返回给 app-server，但 projector 只保留 `action`，UI 又展开显示原始 query，造成正文有链接而工具卡没有来源；相同 query 的两次模型调用还真实请求了两次 Provider。当前 `results` 原样进入 Product View，UI 只显示简洁状态和来源卡，Gateway 在同一 Turn 对 canonical query 合并/复用；公开网页预览图只是来源卡表现层，不创建 Resource。
