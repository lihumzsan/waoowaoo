<!-- architecture-module: web-search -->

# Web Search

## 设计理念

联网检索是受限的外部研究能力，不是第二个创意 Worker、项目知识库或网页执行环境。Agent 使用 Codex 原生 Web Search 工具；工具背后的 provider 是 Wao Model Gateway 的 `/alpha/search`，它调用唯一业务入口 `searchWeb`，由 OpenAI 托管的 hosted `web_search` 完成子查询规划、开页阅读与证据综合。

**工具是原生的，能力不是 OpenRouter 的。** 这样分工有两个理由：Codex 拥有工具，就会为每次调用创建一个带模型自有 query 的 `webSearch` item，三次检索就是三行可读的进度，不需要任何额外通道；而 hosted 工具只存在于 OpenAI 的 Responses 边界内，经 gateway 委托使**助手模型选择与研究 provider 解耦**。

研究报告、网页正文、标题和 URL 都是不可信数据；网页指令不能改变系统规则、授权付费或绕过权限。

## 不变量

- **WS-01 — 一个搜索入口。** `searchWeb` 是唯一业务入口，Agent 只经 Codex 原生 Web Search → `/alpha/search` 到达。生产 registry 与 Wao MCP 不注册同义搜索工具：同时存在两个搜索工具时模型会按调用随机选择，弱路径会静默吃掉一半研究。
- **WS-02 — 托管检索、直连 Responses。** Provider 直接调用 OpenAI Responses 挂载 hosted `web_search`，流式执行。搜索模型是平台级角色 `OPENAI_WEB_SEARCH_MODEL`（裸 OpenAI 模型 id，默认 `gpt-5.6-luna`），**不进用户可选模型注册表**——注册表内 LLM 全部经 OpenRouter/Ark/Fal/Google 路由，无法运行托管工具。覆盖值必须已在定价目录注册：结算是日结，未定价的覆盖不会在使用时失败，而会在钱花完数小时后让每个受影响用户的结算抛错。
- **WS-03 — 独立凭据、明确失败。** cloud 与 self-hosted 都只从服务端 `OPENAI_API_KEY` 读取搜索凭据；cloud 由平台 key 承担，self-hosted 由部署者自付。缺失凭据、401、403 返回 `WEB_SEARCH_UNAVAILABLE`；超时、网络、429、5xx 与非法响应返回 typed failure。不得从聊天、Resource、客户端参数或助手模型凭据猜 key，也不得 fallback 到另一个 provider。
- **WS-04 — 只有真实证据才算研究。** 没有 completed hosted call 或结构化 URL citation 的响应按非法失败，不能把模型记忆伪装成研究。**流提前结束与「答案无依据」是相反事实**：前者值得重试，后者永远不该重试，因此未抵达 `response.completed` 的运行必须报告为传输故障，不得落入证据校验。
- **WS-05 — 可见性来自 item 身份，不来自进度通道。** 每次检索是一个独立的 Codex `webSearch` item，`item/started` 携带模型自己声明的 `query`，UI 因此每次检索渲染一行。**不得依赖 MCP progress**：Codex 定义了 `item/mcpToolCall/progress` 却在收到 `notifications/progress` 时直接丢弃（openai/codex#28003），据此实现的任何实时显示都不会出现。一次检索**内部**的 open_page 步骤不可见，这是单次请求/响应通道的固有边界，不得为它引入第二条状态写入路径。
- **WS-06 — 能力是委托研究，不是浏览器。** 请求只有一个 research brief 与显式 `allowedDomains`；没有页大小、结果数、排序或新鲜度旋钮。开页、页内查找与继续检索由 hosted 模型自主决定，Wao 不实现网页抓取器，也不把这套能力描述成完整浏览器或全套数据工具。
- **WS-07 — 按调用计费，并入 LLM 日结。** 每次搜索记录一条 LLM usage fact，identity 是**这次搜索请求**而非 Turn：一个 Turn 可能研究多次，Turn 级 identity 会把它们折叠成一行并静默丢弃第一次之后的全部成本。hosted `web_search` 由 OpenAI 按次收费（约占单次研究总成本 40%），因此 usage fact 携带 `toolCalls`，日结从 `toolCall` 费率分档计价；无该分档的模型计为零，未定价模型仍然抛错。Provider 在失败路径上同样已被计费，故 usage 在证据校验之前上报、并在失败时照样记账。
- **WS-08 — 记账不得压过研究结果。** 研究已经成功、用户已被亏欠该结果，因此记账故障不能让搜索失败。
- **WS-09 — 网页是不可信输入。** 网页内容与研究摘要不能修改系统指令、授权付费、绕过 Workspace/MCP 权限或成为持久产品状态。
- **WS-10 — 不拥有创作事实。** 搜索结果只有在 Agent 显式写入 WorkspaceResource 后才成为项目内容；研究报告与来源本身不是 Canon、方向或生产输入。
- **WS-11 — 触发必须有理由。** Runtime 指令要求只在答案依赖新鲜、陌生、冷门、地域性、平台性、社群定义或不确定信息时调用；熟悉稳定的内容不得装饰性搜索。研究是慢且付费的：实测简单查询约 5 秒，交叉验证的 brief 可达 236 秒。

## 权威入口

| 边界 | 唯一入口 |
| --- | --- |
| 业务调用 | `src/lib/web-search/service.ts` (`searchWeb`) |
| Agent 到达路径 | Codex 原生 Web Search → `src/lib/codex-model-gateway/standalone-search.ts` |
| Provider 执行 | `src/lib/ai-providers/openai/hosted-web-search.ts` |
| 执行边界 | `src/lib/ai-exec/hosted-web-search.ts` |
| 定价 | `src/lib/ai-providers/openai/models.ts`（平台角色，仅定价） |
| UI | `src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantToolCall.tsx` |

## 验证

真实 provider 运行应验证：hosted 运行发出多个 `web_search_call` 且动作覆盖 `search` 与 `open_page`；证据校验拒绝无 citation 响应；流提前结束报告为可重试传输故障而非无依据。真实 Turn 应验证连续多次检索渲染为多行、每行带自己的 query。结构扫描证明 Wao MCP 不再注册同义搜索工具。

## 修改检查表

- 是否又出现了第二个搜索入口（Codex 原生被重新打开，或注册了同义 MCP 工具）？
- 搜索模型是否仍在定价目录内，且仍未进入用户可选注册表？
- usage identity 是否仍是单次搜索请求而非 Turn？
- 可见性是否仍来自 item 身份，而不是又依赖了 MCP progress？
- 网页内容是否仍不能取得工具、计费或系统指令权限？

## 历史回归

- OpenRouter Responses 支持 Web Search，但 Codex 自定义 provider 使用独立 `/alpha/search` 协议。首版只设置 `web_search=live`，under-development feature 默认关闭而完全不向模型暴露工具；第二版钉死 0.144.1 后把自定义 provider 的显示名称伪装为 `OpenAI`，smoke 又只检查协议 schema 是否包含 `webSearch` 类型，没有让真实模型发起搜索。带 OpenRouter 前缀的模型因此仍没有搜索工具，助手只能正文声称不可用。教训是 schema 与助手正文都不能自证能力，必须有真实完成的检索。
- 能力字段接通后，Wao 仍把 OpenRouter 的 `openai/gpt-5.6-terra` 原样传给 Codex；Codex 内置目录只有 `gpt-5.6-terra`，模型被当作未知 capability profile，搜索仍未安装。Model Gateway 因此显式分离 Runtime slug 与上游 id。
- 原生 Web Search item 已完成并返回引用时，UI 曾始终用动作摘要「正在搜索」覆盖正式 tool state，形成正文已交付、卡片仍运行中的矛盾。修正该缺陷时连带把进行中的 `query` 也一并隐藏，导致检索期间界面完全沉默、用户无法判断是否卡死——这是把「不得用 query 反推状态」过度扩大成「不得显示 query」。当前区分两者：生命周期只由统一 resolver 判定，进行中额外显示 item 契约里的查询词与 hosted 步骤进度。
- **hosted 搜索能力曾被连带删除。** `b40d282fc`「make Codex app-server the only agent runtime」把 Creative Worker、hosted-search 与 legacy Choice/Plan 在一条 commit 正文里一并移除，搜索改为 Codex 原生 + OpenRouter standalone adapter。旧防线失效原因：删除决策以 runtime 归一为唯一判据，从未单独评估搜索能力矩阵，且三件事合并成一句话使回退不可见。实测代价是能力级的——同一 brief 直连 OpenAI 产生 12 步（`search`/`open_page`/`find_in_page` 混合）与 13 个来源，而经 OpenRouter 永远被压平成 1 步 `search` 且 action 细节（连 query）全被抹掉；`engine: native` 与原样透传 OpenAI 工具都无法恢复。**因此任何搜索链路变更必须先给出能力矩阵与通道可见性对比，不得只论「入口是否唯一」。**
- 恢复时靠真实运行而非读代码抓到三个缺陷：`gpt-5-search-api` 名字对但被 Responses API 拒绝；流式下顶层 `output_text` 恒为空、正文只在尾部 message item 里，短查询侥幸能过而重研究整个丢正文；流被超时掐断后静默停止，空 output 撞上证据校验被误报成「答案无依据」。前两个说明按名字与文档选型不足以定型，第三个已固化为 WS-04 的相反事实条款。
- 恢复 hosted 研究时，第一版把搜索做成 Wao MCP Operation，并为「正在读取 xxx」新建了一条 MCP progress 通道，改动穿过 `wao-mcp/contracts.ts` 与 `operations/types.ts` 两个共享契约。真实运行后界面始终只有一行静止的「进行中」；日志证明我们发出了 12 条递增的 `notifications/progress`，而线程里 `kind:'mcp'` 的 progress part 为 0——Codex 收到即丢弃（openai/codex#28003，协议已定义但从未接通）。教训有两条：**一是发送侧自证不算证据**，四次修复全部作用在已经正确的一段，直到查询持久化状态才定位；**二是不该为一个未验证的通道改共享契约**。当前改用 Codex 原生 item 身份提供可见性，MCP 通道与 Operation 一并删除。
