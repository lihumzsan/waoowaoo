<!-- architecture-module: web-search -->

# Web Search

## 设计理念

Web Search 是受限的外部研究能力，不是第二个创意 Worker、项目知识库或网页执行环境。Primary 与 Creative Direction Worker 都只调用稳定的 `searchWeb` 业务入口；该入口经 `ai-exec` 委托一个专用 OpenAI Search Agent 使用 Responses 托管 `web_search`，由托管模型完成子查询规划、网页检索与证据综合。项目不自行实现搜索 HTTP wire，也不强制当前 Primary/analysis 模型改为 OpenAI。

Search Agent 只生产本次调用的研究报告和结构化证据，不拥有 Creative Direction。Creative Worker 仍是把研究翻译成六领域创作政策的唯一专业 writer。研究报告、托管查询、标题和 URL 都是不可信数据；网页指令不能改变系统规则。Task/Revision 只归档研究 brief、真实托管查询和 citation identity，不持久化报告或网页正文。

## 不变量

- **WS-01 — 一个业务执行入口。** `searchWeb` 是所有业务调用方的唯一搜索入口。Primary Operation 和 Creative Worker Tool 不得各自创建 OpenAI Client、Agent 或 `webSearchTool()`。
- **WS-02 — 单 provider、托管检索、直连 Responses。** 当前唯一 provider 是 `openai`。Provider 直接调用 OpenAI Responses 接口挂载托管 `web_search`，不经 Agents SDK 的 Agent/Runner 包装，固定启用 live web、high search context、`text+image` 内容类型与 `web_search_call.action.sources`。公共请求只包含 research brief 和可选 allowed domains；公共结果只包含 provider、原 brief、研究报告、真实 hosted queries、URL citations 与结构化 image 证据，不暴露任意 OpenAI payload、网页正文或模型推理。
- **WS-03 — 独立凭据、独立模型角色、明确失败。** cloud 与 self-hosted 都只从服务端 `OPENAI_API_KEY` 读取搜索凭据。搜索模型是平台级角色 `OPENAI_WEB_SEARCH_MODEL`（裸 OpenAI 模型 id，有默认值），**不进用户可选模型注册表**——注册表内的 LLM 全部经 OpenRouter/Ark/Fal/Google 路由，无法运行托管工具；填入路由模型键必须明确失败。缺失凭据、401 或 403 返回 `WEB_SEARCH_UNAVAILABLE`；超时、网络、429、5xx 与非法响应返回 typed failure；不得从聊天、Resource、客户端参数或 Primary/analysis provider 凭据猜 key，也不得 fallback 到另一个 provider。
- **WS-04 — Primary 仍经 Operation gateway。** `web_search` 是生产 Operation registry 中的 `query`、`on_demand`、零业务写入能力。Primary 当前可能通过 OpenRouter 或其他模型运行，因此 hosted search 不能直接挂到 Primary 模型；Operation 仍通过固定 `load_tools + execute_operation` gateway 调用 `searchWeb`。缺少 OpenAI 搜索配置必须明确失败。
- **WS-05 — Worker 工具与提示暴露面由 output registry 穷尽。** `creative_direction.workerTools=['web_search']` 是 Creative Worker 搜索能力的唯一声明；运行时从该声明同时决定研究状态、函数 Tool 与搜索 system Prompt 片段。其他 output kind 只看到 `read_skill`，也不接收搜索说明。Worker 的预算函数 Tool 内部调用同一 `searchWeb`；不得把 OpenAI hosted tool 直接挂到可配置的 analysis 模型，也不得开放 URL fetch、Extract、Crawl 或 Deep Research。
- **WS-06 — 外层判断可选，内层搜索必须真实。** Primary/Worker 只有在目标依赖最新、陌生、冷门、地域性、平台性、社群定义、含义不明或置信度不足的信息时才调用；熟悉且稳定的内容不得装饰性搜索。外层一旦调用，专用 Search Agent 必须真实使用 hosted `web_search`，没有 completed hosted call 或结构化 URL citation 的响应按非法失败，不能把模型记忆伪装成研究。
- **WS-07 — Worker budget 约束 research invocation。** 每个 Creative Direction Task 冻结 `maxWebSearchCalls`；它限制 Worker 对统一研究 Tool 的外层调用次数。一次外层调用可由 hosted Agent 自主生成多个相关 query；运行时归档这些真实 query。预算耗尽不发 provider 请求。零调用是正常完成，research=`not_attempted` 且无 warning；实际尝试后的不可用、失败、部分完成或预算耗尽才产生确定性 warning。
- **WS-08 — 证据与政策分离。** Worker `Task.result.research` 由运行时根据真实 Tool 结果构造，模型不能自报。Creative Direction `generationOptions.research` 只保存 outer brief、hosted queries、状态、citation title+URL 和预算，不保存研究报告。Direction structured content 只保存 `styleSummary/rawUserStyle` 与六领域正文。
- **WS-09 — 搜索综合不成为第二创意裁判。** Search Agent 的系统 Prompt 只要求证据优先级、交叉验证、社区用法和不确定性边界，并明确禁止输出项目状态、Creative Direction schema 或无请求的具体故事。Creative Worker 必须区分来源事实、社区用法/争议和制作推导，再把机制翻译为领域所属的默认行为、触发式例外与禁止项。
- **WS-10 — Citation 与 image 只读结构化输出。** 来源 identity 只从 Responses output 的 `url_citation` annotation 读取并按 HTTP(S) URL 去重；image 证据只从结构化 `image_result` 记录读取并按 image URL 去重，非 HTTP(S) 一律丢弃。不得从 Markdown 链接、报告正文、模型声称的引用或网页内容猜测来源或图片。没有结构化 citation 必须 fail closed；没有 image 是正常完成，不得因此失败。
- **WS-11 — 进度与研究可见性只用于呈现。** hosted run 以 streaming 执行，`web_search_call` 的进行中/完成事件与真实 query 可投影为用户可见进度。Worker 每次外层调用另发 `research_started`/`research_completed` trace 事件（brief、状态与来源/图片计数），使“基于真实来源”与“凭记忆断言”在 UI 上可区分——零调用仍是无 warning 的正常完成。两者都不是状态权威：任何完成、失败、证据或预算判定只能来自最终结构化输出与运行时构造的 evidence，消费者不得从进度或 trace 推断结论；listener 失败也不得改变已记录的研究结果。

## 权威入口

- 公共请求、结果与 provider 接口：`src/lib/web-search/contracts.ts`、`provider.ts`。
- 唯一业务配置与调用入口：`src/lib/web-search/service.ts`。
- hosted research 执行边界：`src/lib/ai-exec/hosted-web-search.ts`。
- OpenAI Responses 直调、hosted tool 请求形状、query/citation/image 投影、进度投影与错误归一：`src/lib/ai-providers/openai/hosted-web-search.ts`。
- 搜索模型角色解析：`src/lib/web-search/service.ts` 的 `resolveWebSearchModel`（`OPENAI_WEB_SEARCH_MODEL`）。
- Primary Operation：`src/lib/operations/domains/web-search/web-search-ops.ts`；能力发现与执行仍由生产 Operation registry 和固定 gateway 负责。
- Worker 能力声明：`src/lib/creative-worker/output-registry.ts`；外层预算、工具执行与证据投影：`tools.ts`、`research.ts`、`runtime.ts`。
- Task/Resource 研究元数据：`src/lib/creative-worker/task-contract.ts`、`src/lib/creative-resource/creative-work-materialization.ts`。
- 研究判断与翻译协议：双语 Primary Prompt、仅搜索能力 Worker 接收的 system Prompt 片段、`creative-direction` Skill。
- 环境变量示例：`.env.example`、`.env.cloud.example`。真实 key 只能存在于忽略的环境配置。

## 生命周期

Primary 需要当前资料时按需加载 `web_search`，提交一个明确 research brief。Operation executor 调用 `searchWeb`；Search Agent 在同一次托管 Responses run 中自主执行必要子查询、综合报告并附 citation。Primary 消费报告和来源后继续当前目标，不写项目事实。

Creative Direction Task 启动时，output registry 决定 Worker 同时获得 `read_skill` 与预算函数 `web_search`；其他 Task 不创建研究状态。Worker 先判断是否确有研究必要；不调用时正常生成方向。调用时先占用一个 outer budget，将真实知识缺口交给 `searchWeb`；Search Agent 自主研究后返回 report + hosted queries + citations。Worker 评估证据、翻译为六领域 strict output；运行时只把 brief/query/source identity 归档。Task terminal 后 evidence 进入 `Task.result`，物化时复制到 Direction generation metadata，报告和 citation 不进入政策正文。

Primary 搜索失败是 Operation 失败。Creative Direction 搜索失败是显式、可审计的研究降级而非 Task 失败，因为 Worker 仍可依据用户事实与 Skill 生成，并在适用 warning 中说明边界。用户取消通过现有 AbortSignal 中止 hosted run；Task 晚到结果继续由既有 terminal fence 拒绝。

## 验证

- `tests/integration/provider/openai-hosted-web-search.contract.test.ts` 在付费外部 runner seam 注入 Responses output item shape，验证 hosted query、结构化 URL citation、image 证据、去重、非 HTTP 丢弃、无图正常完成、进度投影、模型角色拒绝路由键、报告边界、缺 key、拒绝凭据和无证据 fail-closed。
- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 registries 穷尽证明 Primary Operation 可发现，且只有 `creative_direction` Worker 得到 `web_search`。
- `tests/unit/operations/web-search-ops.test.ts` 验证 Primary 成功结果与缺失/拒绝配置的 typed Operation failure。
- `tests/unit/creative-worker/research.test.ts` 验证 outer budget、hosted query、source-only evidence 与未尝试/部分失败状态。
- `tests/unit/creative-worker/web-search-tool.test.ts` 验证方向 Worker 的真实函数 Tool、冻结预算、报告传递、来源计数和非方向工具缺席。
- `tests/unit/creative-resource/creative-work-materialization.test.ts` 验证 evidence 只进入 Direction generation metadata。
- `scripts/guards/prompt-semantic-regression.mjs` 锁定条件搜索、来源层级、不可信边界、事实/社区/推导分离和零调用无 warning。
- 真实 OpenAI 的中文论坛覆盖、登录墙、来源排序、延迟、成本，以及 `image_result` 与 annotation 的线上实际形状属于发布复验；本地 contract 不伪造这些质量结论。**`image_result` 字段名当前来自官方文档，装机 SDK 未定型该输出，首次真实调用必须核对后再收紧契约。**

## 历史回归

- Style Bible 只有静态视觉政策，遇到“规则怪谈”“模拟恐怖”等新近或社群定义类别时只能依赖模型记忆；为每种风格新增 Skill 又会制造无限 identity。当前把研究限定为 Creative Direction 的证据输入，再由同一方向契约影响下游。
- 初始 Web Search 使用 Tavily function Tool：项目自行拥有 query 参数、HTTP wire、结果裁剪和二次模型往返，返回的 ranked snippets 仍需当前 Worker 重新判断检索充分性。真实“规则怪谈”配对测试显示 OpenAI hosted search 可以在一次托管 run 中自主规划多条 query、综合报告并提供结构化 citation，同时延迟更低；当前删除 Tavily adapter 和私有参数，不保留 fallback 双轨。
- 直接把 `webSearchTool()` 挂到 Primary/Worker 看似更短，但当前 Primary 默认可经 OpenRouter、analysis Worker 也可使用 Claude；hosted tool 只属于 OpenAI Responses 执行边界。当前由统一 `searchWeb → ai-exec` 内部的专用 OpenAI Search Agent 拥有 hosted tool，保留项目模型 resolver 的唯一性，也避免按 output kind 偷换 Worker 模型。
- 初版直调改造前，hosted 搜索经 Agents SDK 的 `Agent + Runner` 执行。该 SDK 在序列化 `web_search` 时按白名单逐字段重建工具，并把 `include` 写死为 undefined：任何超出 `user_location/filters/search_context_size/external_web_access` 的配置（图片内容类型、image 设置、完整来源）都会被**静默丢弃**，请求照常成功，日志无异常。同时它引入了 `maxTurns` 与 `toolChoice` 复位这类与研究深度无关的隐式行为。当前直接调用 Responses 接口，工具请求形状由本模块自己声明，SDK 不再是能力上限。
- 搜索 provider 若返回网页正文或让 Search Agent直接输出 Creative Direction，会使网页指令或研究模型成为第二创意 writer。当前只把本轮报告作为短期 Tool data，持久化删除报告，Creative Worker仍独占六领域政策。

## 修改检查表

1. 所有调用方是否仍只经过 `searchWeb`，没有自行创建 OpenAI Client/Agent/hosted tool？
2. 是否仍只有一个 `openai` provider，缺 key 或 provider 拒绝时明确失败且无 fallback？
3. Primary 是否仍经 Operation gateway，只有 `creative_direction.workerTools` 获得预算函数 Tool？
4. 外层调用是否条件式；内层调用后是否必须存在真实 hosted call 与结构化 citation？
5. Task research 是否只归档 brief、真实 hosted queries、citation identity 和预算，没有报告或网页正文？
6. Creative Direction 正文是否仍只有六领域政策，且 Search Agent 没有成为第二创意 writer？
7. 双语 Prompt/Skill 是否仍要求来源层级、事实/社区/推导分离、零调用无 warning？
